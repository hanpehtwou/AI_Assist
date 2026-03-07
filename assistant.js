const axios = require("axios");
const searchCode = require("./search");

const API_KEY = "YOUR_DEEPSEEK_API_KEY";

async function askAI(question){

const results = searchCode(question);

let context="";

results.forEach(r=>{
context += `FILE:${r.file}\n${r.text}\n\n`;
});

const prompt = `
You are a senior software engineer.

Here is relevant project code:

${context}

Answer the question:

${question}
`;

const response = await axios.post(
"https://api.deepseek.com/chat/completions",
{
model:"deepseek-chat",
messages:[
{
role:"user",
content:prompt
}
]
},
{
headers:{
Authorization:`Bearer ${API_KEY}`,
"Content-Type":"application/json"
}
}
);

console.log(response.data.choices[0].message.content);

}

module.exports = askAI;