# AI Digital Twin — technical architecture

C4 Level 1 (context), Level 2 (containers), and a Level 2 zoom of the Lambda API, plus the chat request path. Production splits the UI and API across AWS. Locally the UI is Next.js on port 3000 and the API is FastAPI on port 8000.

## Context

C4 Level 1. The product is one software system. People and outside services sit around it.

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
    twin["AI Digital Twin<br/>Software system"]
    bedrock["Amazon Bedrock<br/>External system"]
    s3["Amazon S3 memory<br/>External system"]
    github["GitHub<br/>External system"]

    visitor -->|"chat messages<br/>POST chat"| twin
    twin -->|"ChatResponse JSON"| visitor
    owner -->|"persona data + deploy"| twin
    twin -->|"prompt + history"| bedrock
    bedrock -->|"assistant text<br/>Nova converse"| twin
    twin -->|"GetObject / PutObject"| s3
    s3 -->|"session JSON"| twin
    github -->|"CI/CD deploy"| twin
```

The browser never calls Bedrock or S3. The FastAPI API (Lambda in production) is the only client of those two services.

## Containers

C4 Level 2. Optional C4 block, then the flowchart that actually renders.

```mermaid
---
config:
  theme: default
  themeVariables:
    background: "#ffffff"
---
C4Container
    title Container diagram for AI Digital Twin

    Person(visitor, "Website Visitor", "Chats with the twin in the browser")
    Person(owner, "Twin Owner", "Defines persona data and deploys")

    Container_Boundary(twin, "AI Digital Twin") {
        Container(cf, "CloudFront", "CDN, HTTPS", "Serves the static UI and redirects to HTTPS")
        Container(ui, "Frontend S3", "Next.js static export", "Chat UI. twin.tsx POSTs to NEXT_PUBLIC_API_URL/chat")
        Container(apigw, "API Gateway", "HTTP API", "POST /chat, GET /health, GET /. CORS and throttle")
        Container(api, "Lambda API", "Python 3.12, FastAPI, Mangum", "Session memory, persona prompt, Bedrock converse")
        Container(mem, "Memory S3", "Private bucket", "One JSON file per session_id")
    }

    System_Ext(bedrock, "Amazon Bedrock", "Nova converse API")
    System_Ext(cw, "Amazon CloudWatch", "Lambda logs and metrics")
    System_Ext(github, "GitHub", "Source and GitHub Actions CI/CD")

    Rel(visitor, cf, "HTTPS")
    Rel(cf, ui, "Cached static files")
    Rel(ui, apigw, "JSON { message, session_id }", "POST /chat")
    Rel(apigw, api, "AWS_PROXY")
    Rel(api, mem, "GetObject / PutObject")
    Rel(api, bedrock, "Prompt + history")
    Rel(bedrock, api, "Assistant reply")
    Rel(api, cw, "Logs")
    Rel(owner, api, "facts, LinkedIn, style, summary")
    Rel(github, twin, "terraform apply + s3 sync")
```

If C4 rendering is unavailable, this flowchart is the same view:

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
    github[GitHub Actions]

    subgraph twin["AI Digital Twin"]
        cf["CloudFront<br/>CDN, HTTPS"]
        ui["Frontend S3<br/>twin.tsx, page.tsx"]
        apigw["API Gateway<br/>POST /chat, GET /health"]
        api["Lambda API<br/>server.py, Mangum"]
        mem["Memory S3<br/>session_id.json"]
    end

    bedrock[Amazon Bedrock]
    cw[Amazon CloudWatch]

    visitor -->|HTTPS| cf
    cf -->|cached static files| ui
    ui -->|"POST /chat { message, session_id }"| apigw
    apigw -->|AWS_PROXY| api
    api -->|JSON ChatResponse| ui
    api -->|GetObject / PutObject| mem
    mem -->|conversation history| api
    api -->|converse prompt + history| bedrock
    bedrock -->|assistant reply| api
    api -->|logs| cw
    owner -->|backend/data persona| api
    github -->|deploy.sh + terraform| twin
```

## Lambda API

Flow of one `POST /chat` request through the Lambda API.

```mermaid
---
config:
  theme: default
  themeVariables:
    background: "#ffffff"
---
flowchart TB
    apigw["API Gateway<br/>POST /chat { message, session_id }"]
    handler["lambda_handler<br/>Mangum adapter"]
    app["FastAPI app<br/>server.py"]
    chat["chat()"]
    session{"session_id<br/>present?"}
    newId["Create uuid session_id"]
    load["load_conversation()"]
    memGet["Memory S3<br/>GetObject session_id.json"]
    resources["resources.py"]
    subgraph files["Persona files backend/data"]
        facts["facts.json"]
        linkedin["linkedin.pdf"]
        style["style.txt"]
        summary["summary.txt"]
    end
    persona["prompt()<br/>context.py"]
    bedrockCall["call_bedrock()"]
    bedrock["Amazon Bedrock<br/>Nova converse"]
    append["Append user + assistant turns"]
    save["save_conversation()"]
    memPut["Memory S3<br/>PutObject session_id.json"]
    resp["ChatResponse JSON<br/>{ response, session_id }"]

    apigw --> handler --> app --> chat --> session
    session -->|no| newId --> load
    session -->|yes| load
    load --> memGet
    facts --> resources
    linkedin --> resources
    style --> resources
    summary --> resources
    resources --> persona
    memGet --> bedrockCall
    persona --> bedrockCall
    bedrockCall --> bedrock --> append --> save --> memPut --> resp
    resp --> apigw
```

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
    participant UI as Next.js UI
    participant APIGW as API Gateway
    participant API as Lambda FastAPI
    participant Mem as Memory S3
    participant BR as Amazon Bedrock

    Visitor->>UI: Type a message
    UI->>APIGW: POST /chat { message, session_id }
    APIGW->>API: AWS_PROXY invoke
    API->>API: Create session_id if missing
    API->>Mem: GetObject session_id.json
    Mem-->>API: Conversation history or empty
    API->>API: Build persona prompt from facts, LinkedIn, style, summary
    API->>BR: converse(model, history, user message)
    BR-->>API: Assistant text
    API->>Mem: PutObject updated session JSON
    API-->>APIGW: { response, session_id }
    APIGW-->>UI: JSON ChatResponse
    UI-->>Visitor: Show reply and keep session_id
```

## Deployment

GitHub Actions runs `scripts/deploy.sh`. Terraform creates the AWS resources. The Lambda zip is built with Docker (`backend/deploy.py`). The frontend is a Next.js export synced to S3, then CloudFront is invalidated.

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

Locally the UI is `npm run dev` on port 3000 and the API is `uv run python -m uvicorn server:app --reload` on port 8000. Memory is JSON files under `memory/` unless `USE_S3=true`.
