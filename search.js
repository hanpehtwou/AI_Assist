const fs = require("fs");

const index = JSON.parse(fs.readFileSync("code_index.json"));

function searchCode(query){

return index
.filter(item => item.text.toLowerCase().includes(query.toLowerCase()))
.slice(0,5);

}

module.exports = searchCode;