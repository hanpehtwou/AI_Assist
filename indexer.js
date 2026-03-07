const fs = require("fs");
const glob = require("glob");

function scanProject(){

const files = glob.sync("project/**/*.{js,ts,sql,json}");

let docs=[];

files.forEach(file=>{

const content = fs.readFileSync(file,"utf8");

docs.push({
file:file,
content:content
});

});

return docs;

}

module.exports = scanProject;