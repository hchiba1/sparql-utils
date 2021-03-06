fs = require('fs');

let defaultPaths = [`${__dirname}/../etc/endpoints`, `${require('os').homedir()}/.spang/endpoints`];
let dbMap;

const parseDBMap = (text) => {
  text.split('\n').forEach((line) => {
    tokens = line.split(/\s+/);
    if (tokens.length > 1 && !/^ *#/.test(line)) {
      dbMap[tokens[0]] = {
        url: tokens[1],
        byGet: tokens.length > 2 && tokens[2] === 'GET'
      };
    }
  });
};

const readDBMap = (src = null) => {
  dbMap = {};
  if (!src) {
    defaultPaths.forEach((dbPath) => {
      if (fs.existsSync(dbPath)) {
        parseDBMap(fs.readFileSync(dbPath, 'utf8'));
      }
    });
  } else {
    parseDBMap(src);
  }
};

exports.searchDBName = (dbName, src = null) => {
  if (!dbMap || src) {
    readDBMap(src);
  }
  const entry = dbMap[dbName];
  if (entry) {
    return [entry.url, entry.byGet];
  }
};

exports.listup = () => {
  if (!dbMap) {
    readDBMap();
  }
  return dbMap;
};
