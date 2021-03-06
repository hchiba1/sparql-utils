#!/usr/bin/env node

const fs = require('fs');
const program = require('commander');
const child_process = require('child_process');
const csvParse = require('csv-parse/lib/sync');
const columnify = require('columnify');
const temp = require('temp');

const version = require('../package.json').version;
const parser = require('../lib/template_parser');
const formatter = require('../lib/formatter.js');
const metadataModule = require('../lib/metadata.js');
const prefixModule = require('../lib/prefix.js');
const search_db_name = require('../lib/search_db_name');
const shortcut = require('../lib/shortcut.js').shortcut;
const sparql = require('../lib/make_sparql.js');
const querySparql = require('../lib/query_sparql.js');
const alias = require('../lib/alias.js');
const util = require('../lib/util.js');
const initializeConfig = require('../lib/config.js').initialize;
const { getReasonPhrase } = require('http-status-codes');

let templatePath;

let opts = program
  .option('-e, --endpoint <ENDPOINT>', 'target SPARQL endpoint (URL or its predifined name in SPANG_DIR/etc/endpoints,~/.spang/endpoints)')
  .option('-f, --outfmt <FORMAT>', 'tsv, json, n-triples (nt), turtle (ttl), rdf/xml (rdfxml), n3, xml, html, text', 'tsv')
  .option('-c, --align-column', 'align output columns (valid for tsv and text)')
  .option('-s, --sort', 'sort result lines (valid for tsv and text)')
  .option('-j, --json', 'same as -f json')
  .option('-a, --abbr', 'abbreviate results using predefined prefixes')
  .option('-v, --vars', 'variable names are included in output (in the case of tsv format)')
  .option('-S, --subject <SUBJECT>', 'shortcut to specify subject')
  .option('-P, --predicate <PREDICATE>', 'shortcut to specify predicate')
  .option('-O, --object <OBJECT>', 'shortcut to specify object')
  .option('-L, --limit <LIMIT>', 'LIMIT output')
  .option('-F, --from <FROM>', 'shortcut to search FROM specific graph (use alone or with -[SPOLN])')
  .option('-N, --number', 'shortcut to COUNT results (use alone or with -[SPO])')
  .option('-G, --graph', 'shortcut to search for graph names (use alone or with -[SPO])')
  .option('--prefix <PREFIX_FILES>', 'read prefix declarations (default: SPANG_DIR/etc/prefix,~/.spang/prefix)')
  .option('-n, --ignore-user-prefix', 'ignore user-specific file (~/.spang/prefix) for test purpose')
  .option('--ignore-local-prefix', 'ignore local prefix files')
  .option('-m, --method <METHOD>', 'specify GET method (default: POST method)')
  .option('-q, --show-query', 'show query and quit')
  .option('--show-metadata', 'show metadata and quit')
  .option('-d, --debug', 'debug (output expanded template, or output AST with --fmt)')
  .option('--fmt', 'format the query')
  .option('-i, --indent <DEPTH>', 'indent depth; use with --fmt', 2)
  .option('-l, --list-nick-name', 'list up available nicknames of endpoints and quit')
  .option('--stdin', 'read rdf data source from stdin. The format must be Turtle.')
  .option('--time', 'measure time of query execution (exluding construction of query)')
  .option('-r, --reset-option', 'ignore options specified in query file metadata')
  .version(version)
  .helpOption(false)
  .option('-h, --help', 'display help for command') // handle help explicitly
  .arguments('[SPARQL_TEMPLATE] [PARAMS]')
  .description('', {
    SPARQL_TEMPLATE: 'SPARQL template',
    PARAMS: 'par1=val1 par2=val2 ...'
  })
  .action((s) => {
    templatePath = s;
  })
  .parse(process.argv)
  .opts();

if (opts.json) {
  opts.outfmt = 'json';
}

initializeConfig(opts);

let templateFileSpecified = false;
let sparqlTemplate;
let metadata = {};
if (opts.subject || opts.predicate || opts.object ||
    (opts.limit && !templatePath) ||
    opts.number || opts.graph || opts.from) {
  sparqlTemplate = shortcut(opts);
} else if (templatePath != null) {
  templatePath = alias.replaceIfAny(templatePath);
  const templateURL = prefixModule.expandPrefixedUri(templatePath);
  if (templateURL) {
    const syncRequest = require('sync-request');
    sparqlTemplate = syncRequest('GET', templateURL).getBody('utf8');
  } else {
    sparqlTemplate = fs.readFileSync(templatePath, 'utf8');
  }
  metadata = metadataModule.retrieveMetadata(sparqlTemplate);
  if (metadata.option && !opts.resetOption) {
    program.parse(process.argv.concat(metadata.option.split(/\s+/)));
    opts = program.opts();
  }
  templateFileSpecified = true;
}

const input = process.stdin.isTTY ? '' : util.stdinReadSync();
if (opts.fmt) {
  let sparqlQuery;
  if (program.args[0]) {
    sparqlQuery = fs.readFileSync(program.args[0], 'utf8').toString();
  } else if (process.stdin.isTTY) {
    console.error('Format SPARQL query: input is required');
    process.exit(-1);
  } else {
    sparqlQuery = input;
  }
  const syntaxTree = parser.parse(sparqlQuery);
  if (opts.debug) {
    console.log(JSON.stringify(syntaxTree, undefined, 2));
  } else if (opts.outfmt === 'json') {
    console.log(JSON.stringify(syntaxTree, selector, 2));
  } else {
    console.log(formatter.format(syntaxTree, opts.indent));
  }
  process.exit(0);
}

const dbMap = search_db_name.listup();

if (program.args.length < 1) {
  if (!opts.subject && !opts.predicate && !opts.object && !opts.number && !opts.from && !opts.graph && !opts.limit) {
    console.error(`SPANG v${version}: Specify a SPARQL query (template or shortcut).\n`);
    program.help();
  } else if (!opts.endpoint && !dbMap['default']) {
    console.error(`SPANG v${version}: Specify the target SPARQL endpoint (using -e option or in <SPARQL_TEMPLATE>).\n`);
    program.help();
  }
}

if (templateFileSpecified && opts.help) {
  if (metadata.title) {
    console.log(`${metadata.title}`);
  }
  if (metadata.param) {
    Array.from(metadata.param.entries()).forEach(([k, v]) => {
      console.log(`parameter: ${k}=${v}`);
    });
  }
  if (metadata.endpoint) {
    if (dbMap[metadata.endpoint]) {
      console.log(`endpoint: ${dbMap[metadata.endpoint].url}`);
    } else {
      console.log(`endpoint: ${metadata.endpoint}`);
    }
  }
  if (metadata.input) {
    console.log(`input: ${metadata.input}`);
  }
  if (metadata.option) {
    console.log(`option: ${metadata.option}`);
  }
  process.exit(0);
} else if (opts.help) {
  program.help();
  process.exit(0);
}

if (opts.listNickName) {
  console.log('SPARQL endpoints');
  const maxLen = Object.keys(dbMap)
    .map((key) => key.length)
    .reduce((a, b) => Math.max(a, b));
  for (const entry in dbMap) {
    console.log(` ${entry.padEnd(maxLen, ' ')} ${dbMap[entry].url}`);
  }
  process.exit(0);
}

let paramsArr = [];
let paramsMap = {};
program.args.slice(1).forEach((arg) => {
  const matched = arg.match(/^(\S+?)=(.*)$/);
  if (matched) {
    const [, p, v] = matched;
    paramsMap[p] = v;
  } else if (Object.keys(paramsMap).length === 0) {
    paramsArr.push(arg);
  } else {
    console.error(`ERROR: Unnamed '${arg}' specified after named params`);
    process.exit(-1);
  }
});

let db = getDB();

if (opts.debug) {
  console.error(db);
  sparqlTemplate = sparql.expandTemplate(sparqlTemplate, metadata, paramsMap, paramsArr, input);
  console.log(sparql.makePortable(sparqlTemplate, dbMap));
  process.exit(0);
}

if (templateFileSpecified) {
  sparqlTemplate = sparql.makeSparql(sparqlTemplate, metadata, paramsMap, paramsArr, input);
  if (opts.limit) {
    if (!sparqlTemplate.endsWith('\n')) {
      sparqlTemplate += '\n';
    }
    sparqlTemplate += `LIMIT ${opts.limit}\n`;
  }
}

if (opts.showQuery) {
  console.log(sparql.makePortable(sparqlTemplate, dbMap));
  process.exit(0);
}

if (opts.showMetadata) {
  console.log(JSON.stringify(metadata));
  process.exit(0);
}

if (!/^\w/.test(db)) {
  queryLocalFile(db);
  process.exit(0);
}

let retrieveByGet = false;
if (!/^(http|https):\/\//.test(db)) {
  if (!dbMap[db]) {
    queryLocalFile(db);
    process.exit(0);
  } else {
    [db, retrieveByGet] = search_db_name.searchDBName(db);
    if (opts.method && /^get$/i.test(opts.method)) {
      retrieveByGet = true;
    }
  }
}

let start = new Date();
querySparql(db, sparqlTemplate, opts.outfmt, retrieveByGet, (error, statusCode, bodies) => {
  if (error) {
    if (error.code === 'ENOTFOUND') {
      console.error(`${error.code} ${error.syscall} ${error.hostname}`);
    } else if (error.code === 'ECONNREFUSED') {
      console.error(`${error.code} ${error.syscall} ${error.address}:${error.port}`);
    } else {
      console.error(error);
    }
    return;
  }
  if (statusCode != 200) {
    console.error(`${statusCode} ${getReasonPhrase(statusCode)}`);
    if (statusCode != 404 && statusCode != 414 && statusCode != 503) {
      for (let body of bodies) {
        console.error(body);
      }
    }
    return;
  }
  let end = new Date() - start;
  if (bodies.length === 1) {
    if (opts.outfmt === 'tsv') {
      printTsv(jsonToTsv(bodies[0], Boolean(opts.vars)));
    } else if (bodies[0].slice(-1) === '\n') {
      process.stdout.write(bodies[0]);
    } else {
      console.log(bodies[0]);
    }
    if (opts.time) {
      console.error('Time of query: %dms', end);
    }
    return;
  }
  if (['tsv', 'text', 'n-triples', 'nt', 'turtle', 'ttl'].includes(opts.outfmt)) {
    let outputStr = '';
    switch (opts.outfmt) {
      case 'tsv':
        outputStr += jsonToTsv(bodies[0], Boolean(opts.vars));
        for (let i = 1; i < bodies.length; i++) {
          outputStr += '\n' + jsonToTsv(bodies[i]);
        }
        printTsv(outputStr);
        break;
      case 'text':
        outputStr += bodies[0];
        // remove header line for i > 0
        for (let i = 1; i < bodies.length; i++) {
          if (!bodies[i - 1].endsWith('\n')) {
            outputStr += '\n';
          }
          outputStr += bodies[i].substring(bodies[i].indexOf('\n') + 1);
        }
        printTsv(outputStr);
        break;
      default:
        for (let i = 0; i < bodies.length; i++) {
          console.log(bodies[i]);
        }
    }
  } else {
    console.error('The results are paginated. Those pages are saved as result1.out, result2.out,....');
    for (let i = 0; i < bodies.length; i++) {
      fs.writeFileSync(`result${i + 1}.out`, bodies[i]);
    }
  }
});

function queryLocalFile(db) {
  // Save input as a temporary file assuming the format is turtle
  let tmpFile = null;

  if (opts.stdin) {
    tmpFile = temp.path({ suffix: '.ttl' });
    fs.writeFileSync(tmpFile, input);
    db = tmpFile;
  } else if (!fs.existsSync(db)) {
    console.error(`${db}: no such file or endpoint`);
    process.exit(-1);
  }

  let outfmt = opts.outfmt;
  if (opts.outfmt === 'tsv') {
    outfmt = 'json';
  }

  let start = new Date();
  let ret;
  try {
    ret = child_process.execSync(`sparql --data ${db} --results ${outfmt} '${sparqlTemplate}'`);
  } catch (e) {
    process.exit(1);
  }
  let end = new Date() - start;

  const result = ret.toString();
  if (opts.outfmt === 'tsv') {
    printTsv(jsonToTsv(result, Boolean(opts.vars)));
  } else {
    process.stdout.write(result);
  }
  if (opts.time) {
    console.error('Time of query: %dms', end);
  }

  if (tmpFile) {
    fs.unlinkSync(tmpFile);
  }
}

function jsonToTsv(body, withHeader = false) {
  const obj = JSON.parse(body);
  const vars = obj.head.vars;
  const bindings = obj.results.bindings;
  let tsv = '';
  if (withHeader) {
    tsv += vars.join('\t') + '\n';
  }
  tsv += bindings.map((b) => getBindings(vars, b).join('\t')).join('\n');
  return tsv;
}

function getBindings(vars, b) {
  return vars.map((v) => {
    if (!b[v]) {
      return '';
    }
    if (b[v].type === 'uri') {
      if (opts.abbr) {
        return prefixModule.abbreviateURL(b[v].value);
      } else {
        return `<${b[v].value}>`;
      }
    } else if (b[v]['xml:lang']) {
      const lang = b[v]['xml:lang'];
      return `"${b[v].value}"@${lang}`;
    } else if (b[v].type === 'typed-literal' || b[v].type === 'literal' && b[v].datatype) {
      if (b[v].datatype === 'http://www.w3.org/2001/XMLSchema#integer' ||
          b[v].datatype === 'http://www.w3.org/2001/XMLSchema#decimal' ||
          b[v].datatype === 'http://www.w3.org/2001/XMLSchema#double') {
        return b[v].value;
      } else if (opts.abbr) {
        return `"${b[v].value}"^^${prefixModule.abbreviateURL(b[v].datatype)}`;
      } else {
        return `"${b[v].value}"^^<${b[v].datatype}>`;
      }
    } else if (b[v].type === 'bnode') {
      return `_:${b[v].value}`;
    } else {
      return `"${b[v].value}"`;
    }
  });
}

function printTsv(tsv) {
  if (opts.sort) {
    let lines = tsv.split('\n');
    if (opts.vars) {
      tsv = [lines[0]].concat(lines.slice(1).sort()).join('\n');
    } else {
      tsv = lines.slice().sort().join('\n');
    }
  }
  if (opts.alignColumn) {
    console.log(
      columnify(csvParse(tsv, { columns: Boolean(opts.vars), delimiter: '\t', relax: true }), {
        // relax csvParse to accept "hoge"^^xsd:string
        showHeaders: Boolean(opts.vars),
        headingTransform: (x) => x
      }).replace(/\s+$/gm, '')
    );
  } else if (tsv !== '') {
    console.log(tsv);
  }
}

function getTemplateURL(templatePath) {
  let match = /^github:\/\/([^\/]+)\/([^\/]+)\/(.+)/.exec(templatePath);
  if (match) {
    return `https://raw.githubusercontent.com/${match[1]}/${match[2]}/master/${match[3]}`;
  }

  match = /^https:\/\/github.com\/([^\/]+)\/([^\/]+)\/blob\/(.+)/.exec(templatePath);
  if (match) {
    return `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${match[3]}`;
  }

  if (/^(http|https):\/\//.test(templatePath)) {
    return templatePath;
  }
}

function getDB() {
  if (opts.stdin) {
    return '';
  } else if (opts.endpoint) {
    return opts.endpoint;
  } else if (metadata.endpoint) {
    return metadata.endpoint;
  } else if (dbMap['default']) {
    return dbMap['default'].url;
  } else {
    console.error('Endpoint is required');
    process.exit(-1);
  }
}

function selector(key, value) {
  if (key !== 'location') {
    return value;
  }
}
