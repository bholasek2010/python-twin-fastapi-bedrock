# AI Digital Twin — technical architecture

C4 Level 1 (context), Level 2 (containers), a Level 2 zoom of the Lambda API, plus the request path. Production splits the static UI and API across AWS. Locally the UI is Next.js on port 3000 and the API is FastAPI on port 8000. The chat widget is embeddable (live on [OPG Labs](https://opglabs.com/project_digital_twin/)).

## Containers

C4 Level 2. People and externals sit outside the system boundary. Emotion SVGs ship with the frontend. Persona files are packaged into the Lambda zip.

```mermaid
---
config:
  theme: default
  themeVariables:
    background: "#ffffff"
---
flowchart TB
    visitor[Website Visitor]
    owner[Twin Owner]
    host["OPG Labs<br/>opglabs.com"]
    github[GitHub Actions]

    subgraph twin["AI Digital Twin"]
        cf["CloudFront<br/>CDN, HTTPS"]
        ui["Frontend S3<br/>twin.tsx widget + 22 face SVGs"]
        apigw["API Gateway<br/>POST /chat /transcribe /tts /speak"]
        api["Lambda API<br/>server.py, context.py, Mangum"]
        mem["Memory S3<br/>session_id.json"]
    end

    bedrock["Amazon Bedrock<br/>Nova converse"]
    openai["OpenAI<br/>whisper-1, tts-1, gpt-4o-mini"]
    cw[Amazon CloudWatch]

    visitor -->|HTTPS| host
    host -->|embeds widget| ui
    visitor -->|HTTPS| cf
    cf -->|cached static files| ui
    ui -->|POST JSON or audio| apigw
    apigw -->|AWS_PROXY| api
    api -->|ChatResponse JSON or mp3| ui
    owner -->|facts, LinkedIn, style, summary| api
    api -->|GetObject / PutObject| mem
    api -->|prompt + history| bedrock
    bedrock -->|assistant text| api
    api -->|transcribe, speech, face label| openai
    openai -->|transcript, mp3, emotion| api
    api -->|logs| cw
    github -->|deploy.sh + terraform| twin
```

## Lambda API

One `POST /chat`. Persona files are assembled in `prompt()`. Emotion is classified after the reply is saved.

```mermaid
---
config:
  theme: default
  themeVariables:
    background: "#ffffff"
---
flowchart LR
    chat["POST /chat<br/>session + memory"]
    br["Bedrock<br/>persona + history"]
    out["ChatResponse<br/>text, emotion"]

    chat --> br --> out
```

Voice in is a separate `POST /transcribe` (Whisper) that returns transcript text for the same `/chat` path. Voice out is `POST /tts` or `POST /speak` (`tts-1` mp3). The UI pauses the mic until playback ends.

## Request path

```mermaid
---
config:
  theme: default
  themeVariables:
    background: "#ffffff"
---
sequenceDiagram
    autonumber
    actor Visitor as Website Visitor
    participant Host as OPG Labs
    participant UI as Twin widget
    participant APIGW as API Gateway
    participant API as Lambda FastAPI
    participant Mem as Memory S3
    participant BR as Amazon Bedrock
    participant OA as OpenAI

    Visitor->>Host: Open project page
    Host->>UI: Embed Twin widget
    alt Voice input
        Visitor->>UI: Record up to 5s
        UI->>APIGW: POST /transcribe audio
        APIGW->>API: AWS_PROXY invoke
        API->>OA: whisper-1
        OA-->>API: transcript text
        API-->>UI: { text }
    else Typed input
        Visitor->>UI: Type a message
    end
    UI->>APIGW: POST /chat { message, session_id }
    APIGW->>API: AWS_PROXY invoke
    API->>API: Create session_id if missing
    API->>Mem: GetObject session_id.json
    Mem-->>API: Conversation history or empty
    API->>API: Build persona prompt from facts, LinkedIn, style, summary
    API->>BR: converse(model, history, user message)
    BR-->>API: Assistant text
    API->>Mem: PutObject updated session JSON
    API->>OA: Classify reply as one face label
    OA-->>API: anxious face or other enum
    API-->>APIGW: { response, session_id, emotion }
    APIGW-->>UI: JSON ChatResponse
    UI->>UI: Show reply and matching SVG
    UI->>APIGW: POST /tts { text }
    APIGW->>API: AWS_PROXY invoke
    API->>OA: tts-1 alloy mp3
    OA-->>API: audio/mpeg
    API-->>UI: mp3 stream
    UI-->>Visitor: Play on speakers, mic paused until ended
```

## Deployment

GitHub Actions runs `scripts/deploy.sh`. Terraform creates the AWS resources. The Lambda zip is built with Docker (`backend/deploy.py`). The frontend is a Next.js export synced to S3, then CloudFront is invalidated. `OPENAI_API_KEY` is required (GitHub Actions secret, or `backend/.env` for local deploys) and is passed into Lambda as `TF_VAR_openai_api_key`.

```mermaid
---
config:
  theme: default
  themeVariables:
    background: "#ffffff"
---
flowchart LR
    repo[Repo] --> gha[GitHub Actions]
    gha --> zip[Lambda zip via Docker]
    gha --> tf[Terraform]
    zip --> tf
    key["OPENAI_API_KEY secret"] --> tf
    tf --> lambda[Lambda + API Gateway]
    tf --> febucket[Frontend S3]
    tf --> membucket[Memory S3]
    tf --> cf[CloudFront]
    gha --> build["npm run build"]
    build --> febucket
    gha --> inv[CloudFront invalidation]
    inv --> cf
```

Locally the UI is `npm run dev` on port 3000 and the API is `uv run server.py` on port 8000. Memory is JSON files under `memory/` unless `USE_S3=true`. Production memory is a private S3 bucket. `frontend/app/page.tsx` is a 450px shell around `<Twin />` so the same widget can stand alone or sit inside a host page.
