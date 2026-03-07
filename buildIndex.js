const scanProject = require("./indexer");
const chunkText = require("./chunker");
const fs = require("fs");

const docs = scanProject();

let index=[];

docs.forEach(doc=>{

const chunks = chunkText(doc.content);

chunks.forEach(c=>{

index.push({
file:doc.file,
text:c
});

});

});

fs.writeFileSync("code_index.json",JSON.stringify(index,null,2));

console.log("Index built");