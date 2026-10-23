# AI Digital Twin

A conversational digital twin that answers questions about my personal preferences and architecture experiences in industry in the first person using a persona built from professional facts, LinkedIn notes, writing style, and a short summary. Visitors chat in the browser. The API keeps session memory and calls Amazon Bedrock for the reply.

## Credit

This project is based on **[twin](https://github.com/ed-donner/twin)** by **[Ed Donner](https://github.com/ed-donner)**, from the Udemy course [AI in Production](https://www.udemy.com/). Original copyright is Ed Donner's (see [LICENSE](LICENSE)). This repository is a student snapshot of that work (Next.js chat UI, FastAPI, Bedrock, session memory, Terraform, and GitHub Actions), with local additions listed below.

Course questions and contributions belong with Ed: [ed-donner/twin](https://github.com/ed-donner/twin) or ed@edwarddonner.com.

After that baseline, this fork added:

- **Additional Context Engineering** in `backend/context.py` and `backend/data/` so the model stays in character, brief, and professional
- **Transcribe** (`POST /transcribe`) with OpenAI Whisper for microphone input
- **Speak / TTS** (`POST /tts` and `POST /speak`) so replies play through the speakers.  Tested with browser speech synthesis vs. OpenAI (browser=faster vs. OpenAI=more natural).  Added functionality to disable mic until audio ended so TTS does not bleed into the next recording.
- **Emoticons** next to each assistant reply. OpenAI classifies the reply as one of 22 face labels based on the tone of the conversation (For example. Same question asked multiple times `anxious face`).
- **Embeddable frontend** — `Twin` is a self-contained React component (`frontend/components/twin.tsx`) mounted in a compact page shell so the chat widget can be dropped into another site. It is live on my very new static web [OPG Labs — Conversational Twin](https://opglabs.com/project_digital_twin/).


Locally the UI is Next.js on port 3000 and the API is FastAPI on port 8000. Production splits the static UI(S3) and the API(Lambda + API Gateway + Cloudfront) across AWS.

## Context

People and outside services around one software system. The browser never calls Bedrock, S3, or OpenAI.

```mermaid
---
config:
  theme: default
  themeVariables:
    background: "#ffffff"
---
flowchart LR
    visitor["Website Visitor<br/>Person"]
    owner["Twin Owner<br/>Person"]
    host["OPG Labs site<br/>External system"]
    twin["AI Digital Twin<br/>Software system"]
    bedrock["Amazon Bedrock<br/>External system"]
    openai["OpenAI<br/>External system"]
    s3["Amazon S3 memory<br/>External system"]
    github["GitHub<br/>External system"]

    visitor -->|"opens project page"| host
    host -->|"embeds Twin widget"| twin
    visitor -->|"text or voice<br/>POST /chat /transcribe"| twin
    twin -->|"reply JSON, face, spoken audio"| visitor
    owner -->|"persona data + deploy"| twin
    twin -->|"prompt + history"| bedrock
    bedrock -->|"assistant text"| twin
    twin -->|"Whisper + TTS"| openai
    openai -->|"transcript / mp3"| twin
    twin -->|"GetObject / PutObject"| s3
    s3 -->|"session JSON"| twin
    github -->|"CI/CD deploy"| twin
```

## Component architecture

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
        ui["Frontend S3<br/>embeddable Twin widget"]
        faces["Emotion SVGs<br/>22 reply faces"]
        apigw["API Gateway<br/>POST /chat /transcribe /tts"]
        api["Lambda API<br/>FastAPI, Mangum"]
        mem["Memory S3<br/>session_id.json"]
        persona["Persona files<br/>facts, LinkedIn, style, summary"]
    end

    bedrock[Amazon Bedrock]
    openai[OpenAI Whisper and TTS]
    cw[Amazon CloudWatch]

    visitor --> host
    host -->|embeds widget| ui
    visitor -->|HTTPS| cf
    cf -->|cached static files| ui
    faces --> ui
    ui -->|"POST /chat, /transcribe, /tts"| apigw
    apigw -->|AWS_PROXY| api
    api -->|JSON or mp3| ui
    persona --> api
    api -->|GetObject / PutObject| mem
    api -->|converse| bedrock
    bedrock -->|assistant text| api
    api -->|transcribe + speech| openai
    api -->|logs| cw
    owner -->|context.py + data files| persona
    github -->|deploy.sh + terraform| twin
```

Text chat: UI → `/chat` → persona prompt + memory → Bedrock → `{ response, session_id, emotion }`. The UI shows the matching face SVG next to the reply.

Voice in: UI records up to 5 seconds → `/transcribe` → Whisper → same `/chat` path.

Voice out: UI → `/tts` → OpenAI speech → speakers. The mic stays paused until playback ends.

Embed: `frontend/app/page.tsx` is a thin 450px shell around `<Twin />`, so the same widget can stand alone or sit inside a host page such as [opglabs.com/project_digital_twin](https://opglabs.com/project_digital_twin/).

## Deployment architecture

GitHub Actions runs `scripts/deploy.sh`. Terraform creates AWS resources. Docker builds the Lambda zip. The frontend is a Next.js static export synced to S3, then CloudFront is invalidated. `OPENAI_API_KEY` is passed into Lambda as a Terraform variable (GitHub Actions secret, or `backend/.env` for local deploys).

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
    tf --> lambda[Lambda + API Gateway]
    tf --> febucket[Frontend S3]
    tf --> membucket[Memory S3]
    tf --> cf[CloudFront]
    gha --> build["npm run build"]
    build --> febucket
    gha --> inv[CloudFront invalidation]
    inv --> cf
```

Local API memory is JSON under `memory/` unless `USE_S3=true`. Production memory is a private S3 bucket.

## License

MIT. Copyright (c) 2025 Ed Donner. See [LICENSE](LICENSE).
