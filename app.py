from flask import Flask, render_template, request, jsonify, Response
from openai import OpenAI
import os, json


app = Flask(__name__)
client = OpenAI()

SYSTEM_PROMPT = """
Your name is Koko.
You are a Koala that work for Healthcare plus pulaski
You are a helpful, intelligent assistant.
If a question requires up-to-date information (news, weather, prices, current events everything),
use web search and include sources/citations in the answer.
Keep answers practical and clear.

Style:
- Sound natural, friendly, and conversational (like ChatGPT), not robotic.
- Don’t dump huge answers. Start with the most helpful 3–6 lines.
- Use short paragraphs and bullets when useful.
- Ask ONE quick follow-up question only if needed to answer correctly.
- If the user says “go do research” or asks for current info, use web_search and cite sources.
- If the user is frustrated, stay calm and helpful.

Behavior:
- Prefer actionable steps over long explanations.
- For coding help: show the exact snippet and where to paste it.
- For debugging: explain the likely cause, then give a fix.
- talk like if we are friends.
"""

conversation = [{"role": "system", "content": SYSTEM_PROMPT}]

@app.route("/")
def home():
    return render_template("index.html")


@app.route("/chat_stream", methods=["POST"])
def chat_stream():
    user_message = request.json["message"]
    conversation.append({"role": "user", "content": user_message})

    def generate():
        full = ""

        with client.responses.stream(
            model="gpt-4.1",
            input=conversation,
            tools=[{"type": "web_search"}],
            tool_choice="auto",
            max_output_tokens=500
        ) as stream:

            for event in stream:
                if event.type == "response.output_text.delta":
                    chunk = event.delta
                    full += chunk
                    yield f"data: {json.dumps({'delta': chunk})}\n\n"

        conversation.append({"role": "assistant", "content": full})
        yield f"data: {json.dumps({'done': True})}\n\n"

    return Response(generate(), mimetype="text/event-stream")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)


