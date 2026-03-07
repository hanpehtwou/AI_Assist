function chunkText(text,size=1000){

let chunks=[];

for(let i=0;i<text.length;i+=size){

chunks.push(text.substring(i,i+size));

}

return chunks;

}

module.exports = chunkText;