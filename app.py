from flask import Flask, render_template, request, jsonify
from openai import OpenAI

app = Flask(__name__)
client = OpenAI()

SYSTEM_PROMPT = """
Your name is Koko.
You are a helpful, intelligent assistant.
You explain things clearly and keep answers practical, 
"""

conversation = [
    {"role": "system", "content": SYSTEM_PROMPT}
]

@app.route("/")
def home():
    return render_template("index.html")

@app.route("/chat", methods=["POST"])
def chat():
    user_message = request.json["message"]

    conversation.append({"role": "user", "content": user_message})

    response = client.responses.create(
        model="gpt-4.1",
        input=conversation,
        max_output_tokens=500
    )

    reply = response.output_text
    conversation.append({"role": "assistant", "content": reply})

    return jsonify({"reply": reply})


import os

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)


