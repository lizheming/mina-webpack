const path = require('path')
const fs = require('fs-extra')
const JSON5 = require('json5')
const replaceExt = require('replace-ext')
const resolve = require('resolve')
const ensurePosix = require('ensure-posix-path')
const { urlToRequest } = require('loader-utils')
const { parseComponent } = require('vue-template-compiler')
const SingleEntryPlugin = require('webpack/lib/SingleEntryPlugin')
const MultiEntryPlugin = require('webpack/lib/MultiEntryPlugin')
const compose = require('compose-function')

const { toSafeOutputPath } = require('./helpers')

const RESOLVE_EXTENSIONS = ['.js', '.wxml', 'json', 'wxss']

function isAbsoluteUrl(url) {
  return !!url.startsWith('/')
}

function addEntry(context, item, name) {
  if (Array.isArray(item)) {
    return new MultiEntryPlugin(context, item, name)
  }
  return new SingleEntryPlugin(context, item, name)
}

function readConfig(fullpath) {
  let buffer = fs.readFileSync(fullpath)
  let blocks = parseComponent(buffer.toString()).customBlocks
  let matched = blocks.find(block => block.type === 'config')
  if (!matched || !matched.content || !matched.content.trim()) {
    return {}
  }
  return JSON5.parse(matched.content)
}

function getUrlsFromConfig(config) {
  let urls = []
  if (!config) {
    return urls
  }
  if (Array.isArray(config.pages)) {
    urls = [...urls, ...config.pages]
  }
  if (typeof config.usingComponents === 'object') {
    urls = [
      ...urls,
      ...Object.keys(config.usingComponents).map(
        tag => config.usingComponents[tag]
      ),
    ]
  }
  return urls
}

function getItems(rootContext, url) {
  let memory = []

  function search(context, url) {
    let request = urlToRequest(isAbsoluteUrl(url) ? url.slice(1) : path.relative(
      rootContext,
      path.resolve(context, url)
    ))

    let fullpath, isSeparation
    try {
      fullpath = resolve.sync(request, { basedir: rootContext, extensions: [] })
      isSeparation = false
    } catch (error) {
      fullpath = resolve.sync(request, {
        basedir: rootContext,
        extensions: RESOLVE_EXTENSIONS,
      })
      // console.log(fullpath)
      request = `${require.resolve('@tinajs/mina-loader')}!${require.resolve(
        './virtual-mina-loader.js'
      )}?base=${replaceExt(fullpath, '')}!${fullpath}`
      isSeparation = true
    }

    let name = compose(
      ensurePosix,
      (path) => replaceExt(path, '.js'),
      urlToRequest,
      toSafeOutputPath
    )(path.relative(rootContext, fullpath))

    let current = {
      name,
      // url,
      request,
      // isModule,
      // fullpath,
      // isSeparation,
    }

    if (memory.some(item => item.request === current.request)) {
      return
    }
    memory.push(current)

    if (isSeparation) {
      return
    }
    let urls = getUrlsFromConfig(readConfig(fullpath))
    if (urls.length > 0) {
      urls.forEach(url => {
        if (url.startsWith('plugin://')) {
          return
        }
        return search(path.dirname(fullpath), url)
      })
    }
  }

  search(rootContext, url)
  return memory
}

module.exports = class MinaEntryWebpackPlugin {
  constructor(options = {}) {
    this.map =
      options.map ||
      function(entry) {
        return entry
      }

    /**
     * cache items to prevent duplicate `addEntry` operations
     */
    this._items = []
  }

  rewrite(compiler, done) {
    try {
      let { context, entry } = compiler.options

      // assume the latest file in array is the app.mina
      if (Array.isArray(entry)) {
        entry = entry[entry.length - 1]
      }

      getItems(context, entry).forEach(item => {
        if (this._items.some(({ request }) => request === item.request)) {
          return
        }
        this._items.push(item)
        console.log(item.request)
        addEntry(
          context,
          this.map(ensurePosix(item.request)),
          item.name
        ).apply(compiler)
      })
    } catch (error) {
      if (typeof done === 'function') {
        console.error(error)
        return done()
      }
      throw error
    }

    if (typeof done === 'function') {
      done()
    }

    return true
  }

  apply(compiler) {
    compiler.hooks.entryOption.tap('MinaEntryPlugin', () =>
      this.rewrite(compiler)
    )
    compiler.hooks.watchRun.tap('MinaEntryPlugin', (compiler, done) =>
      this.rewrite(compiler, done)
    )
  }
}
