const major = Number(process.versions.node.split(".")[0]);
if (major < 22) { console.error(`Node.js 22+ required; current major is ${major}. Run: nvm install 22 && nvm use 22`); process.exit(1); }
console.log(`Node.js ${process.versions.node} supported`);
