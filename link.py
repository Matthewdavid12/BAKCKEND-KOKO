from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from openai import OpenAI

app = FastAPI(title="KOKO API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

API_KEY = "CHANGE_ME_KOKO"
client = OpenAI()

class ChatIn(BaseModel):
    message: str

@app.get("/")
def home():
    return {"status": "ok", "ai": "KOKO"}


@app.post("/chat")
def chat(data: ChatIn, x_api_key: str = Header(default="")):
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "You are KOKO, a helpful AI assistant."},
            {"role": "user", "content": data.message}
        ]
    )

    return {
        "reply": response.choices[0].message.content
    }