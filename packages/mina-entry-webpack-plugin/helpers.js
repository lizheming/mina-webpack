exports.toSafeOutputPath = function(original) {
  return (original || '')
    // replace '..' to '_'
    .replace(/\.\./g, '_')
    // replace 'node_modules' to '_node_modules_'
    .replace(/node_modules([\/\\])/g, '_node_modules_$1')
}
