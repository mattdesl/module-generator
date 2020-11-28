#!/usr/bin/env node

var semver = require('semver')
var chalk = require('chalk')
var npm = require('npm')
var varName = require('variable-name')
var prompt   = require('inquirer').prompt
var readdirp = require('readdirp')
var conf     = require('npmconf')
var xtend    = require('xtend')
var dotty    = require('dotty')
var path     = require('path')
var fs       = require('fs')
var escape = require('js-string-escape')

var argv = require('yargs')
      .alias('t', 'test')
      .alias('u', 'user')
      .describe('t', 'generate index.js and test.js files')
      .describe('u', 'an organization override for GitHub URLs')
      .argv

var target = process.cwd()

var TEST_RUNNER = 'tape'

//TODO: support alternative test runners like prova
//(argv.t && typeof argv.t === 'string') ? argv.t : 'tape'

getParams(function(err, params) {
  if (err) throw err

  readdirp({
    root: path.join(__dirname, 'templates')
  }).on('data', function(file) {
    var dest = path.resolve(target, file.path)

    if (!argv.t) {
      if (file.path === 'index.js' || file.path === '_test.js')
        return
    }

    if (fs.existsSync(dest)) {
      return console.log('ignoring: ' + file.path)
    }

    fs.readFile(file.fullPath, 'utf8', function(err, content) {
      if (err) throw err

      content = render(content, params)

      if (file.name.match(/\.json$/g)) {
        content = JSON.stringify(JSON.parse(content), null, 2)
      }

      if (file.name.match(/\_\.gitignore$/g)) 
        dest = dest.replace('_.gitignore', '.gitignore')
      else if (file.name.match(/\_\.npmignore$/g))
        dest = dest.replace('_.npmignore', '.npmignore')
      else if (file.name === '_test.js')
        dest = dest.replace('_test.js', 'test.js')

      fs.writeFile(dest, content)
    })
  })
})

function render(template, params) {
  return template.replace(/\{\{([^}]+)}}/g, function(_, name) {
    return dotty.get(params, name)
  })
}

function getParams(done) {
  conf.load({}, function(err, config) {
    if (err) return done(err)

    var data = {
      user: {
          name: config.get('init.author.name')
        , url: config.get('init.author.url')||''
        , email: config.get('init.author.email')
        , github: config.get('init.author.github')
        , username: config.get('username')
      }
    }

    if (typeof argv.u === 'string') {
      data.org = { name: argv.u, github: argv.u }
      console.log(chalk.green('Creating module under organization '+chalk.bold(data.org.name)))
    } else if (argv.u) {
      return done('--user specified, but without an organization!')
    }

    // if (!data.user.username) return bail('npm login')
    if (!data.user.name) return bail('npm config set init.author.name "Your Name"')
    if (!data.user.email) return bail('npm config set init.author.email "me@example.com"')
    if (!data.user.github) return bail('npm config set init.author.github "your-github-handle"')

    //default org to user
    if (!data.org) {
      data.org = {
        name: data.user.name,
        github: data.user.github
      }
    }

    if (!data.user.url) {
      data.user.url = 'https://github.com/'+data.user.github
    }

    prompt([
      {
          'name': 'name'
        , 'message': 'Module name'
        , 'default': path.basename(target)
      },
      {
          'name': 'description'
        , 'message': 'Module description'
      },
      {
          'name': 'tags'
        , 'message': 'Module tags:'
      },
      {
          'name': 'stability'
        , 'type': 'list'
        , 'message': 'Module stability:'
        , 'default': 'experimental'
        , 'choices': [
            'deprecated'
          , 'experimental'
          , 'unstable'
          , 'stable'
          , 'frozen'
          , 'locked'
        ]
      }
    ], function(results) {
      if (err) return done(err)

      results.name = dequote(results.name)
      results.testDescription = escape(results.description).replace(/\\"+/g, '\"')
      results.description = dequote(results.description)
      results.varName = varName(results.name)
      results.tags = JSON.stringify(results.tags.split(' ').map(function(str) {
        return dequote(str).trim()
      }).filter(Boolean), null, 2)
      results.devDependencies = '{}'

      if (argv.t) {
        handleInstall(function(err, dep) {
          if (err)
            console.log(chalk.red('Error installing '+TEST_RUNNER+' '+err))
          else {
            //prefix for --save-dev
            var prefix = config.get('save-prefix')
            if (prefix && semver.gte(dep[1], '0.1.0')) 
              dep[1] = prefix+dep[1]
            
            console.log(chalk.green('Installed '+dep.join('@')))

            var obj = {}
            obj[dep[0]] = dep[1]
            results.devDependencies = JSON.stringify(obj, null, 2)
          }
          done(null, xtend(results, data))
        })
      } else {
        done(null, xtend(results, data))
      }


      
    })
  })
}

function handleInstall(callback) {
  npm.load({
      saveDev: true
  }, function(err) {
      npm.commands.install([TEST_RUNNER], function(err, data) {
          if (!err) {
            data = data[data.length-1][0]
            data = data.split('@')
          }

          if (callback) 
            callback(err, data)
      });
      npm.on("log", function(message) {
          console.log(message);
      });
  });
}

function bail(cmd) {
  console.log('')
  console.log('Missing configuration option, please run the following using your own value:')
  console.log('')
  console.log('  > ' + cmd)
  console.log('')
}

function dequote(str) {
  return str.replace(/\"+/g, '\\"')
}
