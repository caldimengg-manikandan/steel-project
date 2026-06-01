const mongoose = require('mongoose');
const uri = "mongodb://hariithejj05_db_user:v3UicNDmXlu6emEn@ac-c9tq81e-shard-00-00.pjtpr4i.mongodb.net:27017,ac-c9tq81e-shard-00-01.pjtpr4i.mongodb.net:27017,ac-c9tq81e-shard-00-02.pjtpr4i.mongodb.net:27017/steel_dms?ssl=true&replicaSet=atlas-c9tq81e-shard-0&authSource=admin&retryWrites=true&w=majority&appName=steel-DMS";
mongoose.connect(uri).then(() => {
  console.log("Connected successfully!");
  process.exit(0);
}).catch(err => {
  console.error("Connection failed:", err);
  process.exit(1);
});
