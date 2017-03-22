var path = require('path');
var objectAssign = require('object-assign');
var hashSum = require('hash-sum');
var compiler = require('vue-template-compiler');

var compileTemplate = require('./lib/template-compiler');
var insertCSS = require('./lib/insert-css');

// exports
module.exports = function(content, file, conf) {
  var scriptStr = '';
  var output, configs, vuecId, jsLang;

  // configs
  configs = objectAssign({
    extractCSS: true,
    cssScopedFlag: '__vuec__',
    cssScopedIdPrefix: '_v-',
    cssScopedHashType: 'sum',
    cssScopedHashLength: 8,
    styleNameJoin: '',

    runtimeOnly: false,
  }, conf);

  // replace scoped flag
  function replaceScopedFlag(str) {
    var reg = new RegExp('([^a-zA-Z0-9\-_])('+ configs.cssScopedFlag +')([^a-zA-Z0-9\-_])', 'g');
    str = str.replace(reg, function($0, $1, $2, $3) {
      return $1 + vuecId + $3;
    });
    return str;
  }

  // 兼容content为buffer的情况
  content = content.toString();

  // scope replace
  if (configs.cssScopedType == 'sum') {
    vuecId = configs.cssScopedIdPrefix + hashSum(file.subpath);
  } else {
    vuecId = configs.cssScopedIdPrefix + fis.util.md5(file.subpath, configs.cssScopedHashLength);
  }
  content = replaceScopedFlag(content);

  // parse
  var output = compiler.parseComponent(content.toString(), { pad: true });

  // script
  if (output.script) {
    scriptStr = output.script.content;
    jsLang = output.script.lang || 'js';
  } else {
    scriptStr += 'module.exports = {}';
    jsLang = 'js';
  }

  // 部分内容以 js 的方式编译一次。如果要支持 cooffe 需要这么配置。
  // 只针对预编译语言
  // fis.match('*.vue:cooffe', {
  //   parser: fis.plugin('cooffe')
  // })
  scriptStr = fis.compile.partial(scriptStr, file, {
    ext: jsLang,
    isJsLike: true
  });

  if(output.template){
    var templateContent = fis.compile.partial(output.template.content, file, {
      ext: output.template.lang || 'html',
      isHtmlLike: true
    });
    // runtimeOnly
    if(configs.runtimeOnly){
      var result = compileTemplate(templateContent);
      if(result){
        scriptStr += '\n;\n(function(renderFun, staticRenderFns){\n'
        scriptStr += '\nif(module && module.exports){ module.exports.render=renderFun; module.exports.staticRenderFns=staticRenderFns;}\n';
        scriptStr += '\nif(exports && exports.default){ exports.default.render=renderFun; exports.default.staticRenderFns=staticRenderFns;}\n';
        scriptStr += '\n})(' + result.render + ',' + result.staticRenderFns + ');\n';
      }
    }else{
      // template
      scriptStr += '\n;\n(function(template){\n'
      scriptStr += '\nmodule && module.exports && (module.exports.template = template);\n';
      scriptStr += '\nexports && exports.default && (exports.default.template = template);\n';
      scriptStr += '\n})(' + JSON.stringify(templateContent) + ');\n';
    }
  }

  // style
  output['styles'].forEach(function(item, index) {
    if(!item.content){
      return;
    }

    // empty string, or all space line
    if(/^\s*$/.test(item.content)){
      return;
    }

    // css也采用片段编译，更好的支持less、sass等其他语言
    var styleContent = fis.compile.partial(item.content, file, {
      ext: item.lang || 'css',
      isCssLike: true
    });

    if(!configs.extractCSS){
      scriptStr += '\n;(' + insertCSS + ')(' + JSON.stringify(styleContent) + ');\n';
      return;
    }

    var styleFileName, styleFile;

    if (output['styles'].length == 1) {
      styleFileName = file.realpathNoExt + configs.styleNameJoin + '.css';
    } else {
      styleFileName = file.realpathNoExt + configs.styleNameJoin + '-' + index + '.css';
    }

    styleFile = fis.file.wrap(styleFileName);

    styleFile.cache = file.cache;
    styleFile.isCssLike = true;
    styleFile.setContent(styleContent);
    fis.compile.process(styleFile);
    styleFile.links.forEach(function(derived) {
      file.addLink(derived);
    });
    file.derived.push(styleFile);
    file.addRequire(styleFile.getId());
  });

  // 处理一遍scoped css
  scriptStr = replaceScopedFlag(scriptStr);

  return scriptStr;
};
