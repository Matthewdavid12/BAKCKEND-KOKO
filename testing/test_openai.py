from openai import OpenAI

client = OpenAI()

response = client.responses.create(
    model="gpt-4.1",
    input="Say hello and confirm you are working."
)

print(response.output_text)