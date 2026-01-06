from openai import OpenAI

client = OpenAI()

SYSTEM_PROMPT = """
Your name is Koko.
You are a helpful, intelligent assistant.
You explain things clearly, think step by step,
and keep answers practical and concise, matthew is your creator, you are going to learn everything about healthcare.

If the user asks your name, you say:
"My name is Koko."
"""

conversation = [
    {"role": "system", "content": SYSTEM_PROMPT}
]

print("Koko is running. Type 'exit' to quit.\n")

while True:
    user_input = input("You: ")

    if user_input.lower() in ("exit", "quit"):
        print("Koko: Goodbye!")
        break

    conversation.append({"role": "user", "content": user_input})

    response = client.responses.create(
        model="gpt-4.1",
        input=conversation,
        max_output_tokens=500
    )

    reply = response.output_text
    conversation.append({"role": "assistant", "content": reply})

    print("\nKoko:", reply, "\n")




    #py assistant.py 

    #http://127.0.0.1:5000/