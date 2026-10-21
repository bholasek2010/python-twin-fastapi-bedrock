from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import os
from dotenv import load_dotenv
from typing import Literal, Optional, List, Dict
import json
import re
import uuid
from datetime import datetime
import io
import boto3
from botocore.exceptions import ClientError
from openai import OpenAI
from context import prompt

# Load environment variables
load_dotenv()

app = FastAPI()

# Configure CORS
origins = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001",
).split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# Initialize Bedrock client - see Q42 on https://edwarddonner.com/faq if the Region gives you problems
bedrock_client = boto3.client(
    service_name="bedrock-runtime", 
    region_name=os.getenv("DEFAULT_AWS_REGION", "us-east-1")
)

# Bedrock model selection - see Q42 on https://edwarddonner.com/faq for more
BEDROCK_MODEL_ID = os.getenv("BEDROCK_MODEL_ID", "global.amazon.nova-2-lite-v1:0")

# Memory storage configuration
USE_S3 = os.getenv("USE_S3", "false").lower() == "true"
S3_BUCKET = os.getenv("S3_BUCKET", "")
MEMORY_DIR = os.getenv("MEMORY_DIR", "../memory")

# Initialize S3 client if needed
if USE_S3:
    s3_client = boto3.client(
        service_name="s3", 
        region_name=os.getenv("DEFAULT_AWS_REGION", "us-east-1")
    )

# Request/Response models
class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None


class ChatResponse(BaseModel):
    response: str
    session_id: str
    emotion: str = "neutral"


EMOTIONS = (
    "sorry",
    "sad",
    "unhappy",
    "depressed",
    "lonely",
    "upset",
    "worried",
    "concerned",
    "afraid",
    "scared",
    "anxious",
    "surprised",
    "shocked",
    "excited",
    "confused",
    "grateful",
    "friendly",
    "happy",
    "thoughtful",
    "curious",
    "neutral",
)

EmotionFace = Literal[
    "sorry face",
    "sad face",
    "unhappy face",
    "depressed face",
    "lonely face",
    "upset face",
    "hurt face",
    "worried face",
    "concerned face",
    "afraid face",
    "scared face",
    "anxious face",
    "surprised face",
    "shocked face",
    "excited face",
    "confused face",
    "grateful face",
    "friendly face",
    "happy face",
    "thoughtful face",
    "curious face",
    "neutral face",
]


class EmotionClassification(BaseModel):
    label: EmotionFace


def parse_emotion_label(raw: str) -> str | None:
    """Accept labels like 'Anxious', 'anxious face', or '**anxious**'."""
    cleaned = (raw or "").lower()
    for ch in "*_`#\"'.,!?:;()[]":
        cleaned = cleaned.replace(ch, " ")
    tokens = cleaned.split()
    for emotion in sorted(EMOTIONS, key=len, reverse=True):
        if emotion in tokens:
            return emotion
    for emotion in sorted(EMOTIONS, key=len, reverse=True):
        if emotion in cleaned:
            return emotion
    return None


def strip_face_label(text: str) -> str:
    """Remove labels like 'anxious face' or '**Anxious face**' from reply text."""
    cleaned = text or ""
    labels = [f"{emotion} face" for emotion in sorted(EMOTIONS, key=len, reverse=True)]
    for label in labels:
        cleaned = re.sub(
            rf"(?i)[\*_`#\"'\[\(]*\b{re.escape(label)}\b[\*_`#\"'\]\)]*[:.\-]*",
            " ",
            cleaned,
        )
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip(" \t\n:-")


def classify_question_tone_heuristic(text: str) -> str:
    """Keyword fallback when the model is unavailable."""
    q = (text or "").strip().lower()
    if not q:
        return "neutral"

    def has(*words: str) -> bool:
        return any(word in q for word in words)

    if has("sorry"):
        return "sorry"
    if has("depressed"):
        return "depressed"
    if has("lonely", "miss you"):
        return "lonely"
    if has("unhappy"):
        return "unhappy"
    if has("upset"):
        return "upset"
    if has("hurt"):
        return "hurt"
    if has("sad"):
        return "sad"
    if has("afraid"):
        return "afraid"
    if has("scared"):
        return "scared"
    if has("anxious", "anxiety", "nervous", "uneasy", "tense"):
        return "anxious"
    if has("worried"):
        return "worried"
    if has("concerned", "risk", "problem", "wrong"):
        return "concerned"
    if has("shock", "unbelievable", "really?!"):
        return "shocked"
    if has("wow", "whoa", "no way"):
        return "surprised"
    if has("excited", "can't wait", "amazing", "awesome", "love this", "congrats"):
        return "excited"
    if has("confused", "don't understand", "dont understand", "unclear", "lost me", "huh"):
        return "confused"
    if has("thank", "thanks", "appreciate"):
        return "grateful"
    if has("nice to meet", "hello", "hey", "how are you") or q in {"hi", "hi!", "hey!", "hello!"} or q.startswith("hi ") or q.startswith("hey "):
        return "friendly"
    if has("happy", "glad", "great news", "wonderful", "smile"):
        return "happy"
    if has("think", "thoughts", "reflect", "consider", "opinion", "should i", "advice"):
        return "thoughtful"
    if has("why", "how", "what", "when", "where", "who", "curious") or q.endswith("?"):
        return "curious"
    return "neutral"


def classify_question_tone(text: str, reply: str = "") -> str:
    """Pick a favicon emotion from the assistant reply, using OpenAI when possible."""
    reply_text = (reply or text or "").strip()
    try:
        client = get_openai_client()
        result = client.chat.completions.parse(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Classify the emotional tone of the assistant reply. "
                        "Choose exactly one allowed face label. "
                        "Use 'anxious face' when the reply sounds nervous, uneasy, or tense."
                    ),
                },
                {"role": "user", "content": reply_text[:2000]},
            ],
            response_format=EmotionClassification,
            temperature=0,
        )
        message = result.choices[0].message
        raw_label = (
            message.parsed.label
            if message.parsed
            else (message.content or "")
        )
        print(f"Emotion classifier raw: {raw_label!r}")
        word = parse_emotion_label(raw_label)
        if word:
            return word
    except Exception as e:
        print(f"Emotion classification fallback: {e}")
    return classify_question_tone_heuristic(reply_text)


class Message(BaseModel):
    role: str
    content: str
    timestamp: str


class TtsRequest(BaseModel):
    text: str


def get_openai_client() -> OpenAI:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="OPENAI_API_KEY is not configured",
        )
    return OpenAI(api_key=api_key)


# Memory management functions
def get_memory_path(session_id: str) -> str:
    return f"{session_id}.json"


def load_conversation(session_id: str) -> List[Dict]:
    """Load conversation history from storage"""
    if USE_S3:
        try:
            response = s3_client.get_object(Bucket=S3_BUCKET, Key=get_memory_path(session_id))
            return json.loads(response["Body"].read().decode("utf-8"))
        except ClientError as e:
            if e.response["Error"]["Code"] == "NoSuchKey":
                return []
            raise
    else:
        # Local file storage
        file_path = os.path.join(MEMORY_DIR, get_memory_path(session_id))
        if os.path.exists(file_path):
            with open(file_path, "r") as f:
                return json.load(f)
        return []


def save_conversation(session_id: str, messages: List[Dict]):
    """Save conversation history to storage"""
    if USE_S3:
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=get_memory_path(session_id),
            Body=json.dumps(messages, indent=2),
            ContentType="application/json",
        )
    else:
        # Local file storage
        os.makedirs(MEMORY_DIR, exist_ok=True)
        file_path = os.path.join(MEMORY_DIR, get_memory_path(session_id))
        with open(file_path, "w") as f:
            json.dump(messages, f, indent=2)


def call_bedrock(conversation: List[Dict], user_message: str) -> str:
    """Call AWS Bedrock with conversation history"""
    
    # Build messages in Bedrock format
    messages = []
    
    # Add system prompt as first user message
    # Or there's a better way to do this - pass in system=[{"text": prompt()}] to the converse call below
    messages.append({
        "role": "user", 
        "content": [{"text": f"System: {prompt()}"}]
    })
    
    # Add conversation history (limit to last 25 exchanges)
    for msg in conversation[-50:]:
        messages.append({
            "role": msg["role"],
            "content": [{"text": msg["content"]}]
        })
    
    # Add current user message
    messages.append({
        "role": "user",
        "content": [{"text": user_message}]
    })
    
    try:
        # Call Bedrock using the converse API
        response = bedrock_client.converse(
            modelId=BEDROCK_MODEL_ID,
            messages=messages,
            inferenceConfig={
                "maxTokens": 2000,
                "temperature": 0.7,
                "topP": 0.9
            }
        )
        
        # Extract the response text
        return response["output"]["message"]["content"][0]["text"]
        
    except ClientError as e:
        error_code = e.response['Error']['Code']
        if error_code == 'ValidationException':
            # Handle message format issues
            print(f"Bedrock validation error: {e}")
            raise HTTPException(status_code=400, detail="Invalid message format for Bedrock")
        elif error_code == 'AccessDeniedException':
            print(f"Bedrock access denied: {e}")
            raise HTTPException(status_code=403, detail="Access denied to Bedrock model")
        else:
            print(f"Bedrock error: {e}")
            raise HTTPException(status_code=500, detail=f"Bedrock error: {str(e)}")


@app.get("/")
async def root():
    return {
        "message": "AI Digital Twin API (Powered by AWS Bedrock)",
        "memory_enabled": True,
        "storage": "S3" if USE_S3 else "local",
        "ai_model": BEDROCK_MODEL_ID
    }


@app.get("/health")
async def health_check():
    return {
        "status": "healthy", 
        "use_s3": USE_S3,
        "bedrock_model": BEDROCK_MODEL_ID
    }


@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    try:
        # Generate session ID if not provided
        session_id = request.session_id or str(uuid.uuid4())

        # Load conversation history
        conversation = load_conversation(session_id)

        # Call Bedrock for response
        assistant_response = call_bedrock(conversation, request.message)
        emotion = classify_question_tone(assistant_response)
        if emotion not in EMOTIONS:
            emotion = "neutral"
        assistant_response = strip_face_label(assistant_response)

        # Update conversation history
        conversation.append(
            {"role": "user", "content": request.message, "timestamp": datetime.now().isoformat()}
        )
        conversation.append(
            {
                "role": "assistant",
                "content": assistant_response,
                "timestamp": datetime.now().isoformat(),
            }
        )

        # Save conversation
        save_conversation(session_id, conversation)

        return ChatResponse(
            response=assistant_response,
            session_id=session_id,
            emotion=emotion,
        )

    except HTTPException:
        raise
    except Exception as e:
        print(f"Error in chat endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/conversation/{session_id}")
async def get_conversation(session_id: str):
    """Retrieve conversation history"""
    try:
        conversation = load_conversation(session_id)
        return {"session_id": session_id, "messages": conversation}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


MAX_AUDIO_BYTES = 1_500_000
MAX_TRANSCRIPT_CHARS = 100;


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    """Convert recorded speech to text with OpenAI Whisper."""
    try:
        audio_bytes = await file.read()
        if not audio_bytes:
            raise HTTPException(status_code=400, detail="Empty audio upload")
        if len(audio_bytes) > MAX_AUDIO_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"Audio is too large. Keep recordings under {MAX_AUDIO_BYTES // 1000} KB.",
            )

        filename = file.filename or "recording.webm"
        client = get_openai_client()
        transcript = client.audio.transcriptions.create(
            model="whisper-1",
            file=(filename, io.BytesIO(audio_bytes), file.content_type or "audio/webm"),
        )
        return {"text": transcript.text.strip()[:MAX_TRANSCRIPT_CHARS]}
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error in transcribe endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/speak")
@app.post("/tts")
async def tts(request: TtsRequest):
    """Stream OpenAI text-to-speech audio for an assistant reply."""
    text = (request.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is required")

    # tts-1 accepts up to 4096 input characters
    text = text[:4096]
    client = get_openai_client()

    try:
        speech = client.audio.speech.create(
            model="tts-1",
            voice=os.getenv("OPENAI_TTS_VOICE", "alloy"),
            input=text,
            response_format="mp3",
        )
        return StreamingResponse(
            speech.iter_bytes(),
            media_type="audio/mpeg",
            headers={"Cache-Control": "no-store"},
        )
    except Exception as e:
        print(f"Error in tts endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)