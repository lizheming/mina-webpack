const path = require('path')
const JSON5 = require('json5')
const resolve = require('resolve')
const merge = require('lodash.merge')
const compose = require('compose-function')
const replaceExt = require('replace-ext')
const loaderUtils = require('loader-utils')
const ensurePosix = require('ensure-posix-path')
const pMap = require('p-map')

const helpers = require('../helpers')

const RESOLVE_EXTENSIONS = ['.js', '.wxml', 'json', 'wxss']

function stripExt(path) {
  return replaceExt(path, '')
}

function mapObject(object, iteratee) {
  let result = {}
  for (let key in object) {
    result[key] = iteratee(object[key], key, object)
  }
  return result
}

function resolveFile(dirname, target, context) {
  let _resolve = target =>
    compose(
      ensurePosix,
      helpers.toSafeOutputPath,
      stripExt
    )(resolveFromModule(context, target))

  if (target.startsWith('/')) {
    return _resolve(target.slice(1))
  }

  // relative url
  return _resolve(path.relative(context, path.resolve(dirname, target)))
}

function resolveFromModule(context, filename) {
  return path.relative(
    context,
    resolve.sync(loaderUtils.urlToRequest(filename), {
      basedir: context,
      extensions: RESOLVE_EXTENSIONS,
    })
  )
}

module.exports = function(source) {
  const done = this.async()
  const webpackOptions = loaderUtils.getOptions(this) || {}
  const options = merge(
    {},
    {
      publicPath: helpers.getPublicPath(webpackOptions, this),
    },
    webpackOptions
  )
  const relativeToRoot = path.relative(
    path.dirname(this.resource),
    this.rootContext
  )
  const loadModule = helpers.loadModule.bind(this)

  let config
  try {
    config = JSON5.parse(source)
  } catch (error) {
    return done(error)
  }

  if (!config) {
    return done(null, '')
  }

  Promise.resolve(config)
    /**
     * pages
     */
    .then(config => {
      if (!Array.isArray(config.pages)) {
        return config
      }
      return Object.assign(config, {
        pages: config.pages.map(page =>
          resolveFile(this.context, page, this.rootContext)
        ),
      })
    })
    /**
     * usingComponent
     */
    .then(config => {
      if (typeof config.usingComponents !== 'object') {
        return config
      }
      return Object.assign(config, {
        usingComponents: mapObject(config.usingComponents, file => {
          if (file.startsWith('plugin://')) {
            return file
          }
          return `/${resolveFile(this.context, file, this.rootContext)}`
        }),
      })
    })
    /**
     * tabBar
     */
    .then(config => {
      if (!config.tabBar || !Array.isArray(config.tabBar.list)) {
        return config
      }

      function loadAndReplace(tab, field) {
        return loadModule(tab[field])
          .then(source => helpers.extract(source, options.publicPath))
          .then(outputPath =>
            Object.assign(tab, {
              [field]: outputPath,
            })
          )
      }

      return pMap(config.tabBar.list, tab => {
        if (tab.pagePath) {
          tab = Object.assign(tab, {
            pagePath: ensurePosix(stripExt(tab.pagePath)),
          })
        }
        return Promise.resolve(tab)
          .then(tab => {
            if (!tab.iconPath) {
              return tab
            }
            return loadAndReplace(tab, 'iconPath')
          })
          .then(tab => {
            if (!tab.selectedIconPath) {
              return tab
            }
            return loadAndReplace(tab, 'selectedIconPath')
          })
      }).then(list =>
        Object.assign(config, {
          tabBar: Object.assign(config.tabBar, {
            list,
          }),
        })
      )
    })
    .then(config => done(null, JSON.stringify(config, null, 2)))
    .catch(error => done(error))
}
