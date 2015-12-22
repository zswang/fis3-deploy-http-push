/**
 * fis.baidu.com
 */
var _ = fis.util;

var fs = require('fs');
var path = require('path');

function upload(receiver, to, release, content, file, callback) {
  var subpath = file.subpath;
  fis.util.upload(
    //url, request options, post data, file
    receiver, null, {
      to: to + release
    }, content, subpath,
    function(err, res) {
      if (err || res.trim() != '0') {
        callback('upload file [' + subpath + '] to [' + to +
          '] by receiver [' + receiver + '] error [' + (err || res) + ']');
      } else {
        var time = '[' + fis.log.now(true) + ']';
        process.stdout.write(
          ' - '.green.bold +
          time.grey + ' ' +
          subpath.replace(/^\//, '') +
          ' >> '.yellow.bold +
          to + release +
          '\n'
        );
        callback();
      }
    }
  );
}

module.exports = function(options, modified, total, callback) {
  if (!options.to) {
    throw new Error('options.to is required!');
  } else if (!options.receiver) {
    throw new Error('options.receiver is required!');
  }

  // 处理缓存文件
  var cachePostSuccessFile;
  var cachePostSuccess;
  if (options.cacheDir) { // 配置了缓存目录
    _.mkdir(options.cacheDir);
    cachePostSuccessFile = path.join(options.cacheDir, 'postsuccess.txt');
    if (fs.existsSync(cachePostSuccessFile)) {
      cachePostSuccess = String(fs.readFileSync(cachePostSuccessFile)).split(/\n\r?/);

      // 对于无 hash 的文件，只留下最近一个提交记录
      var dict = {};
      for (var i = cachePostSuccess.length - 1; i >= 0; i--) {
        var items = cachePostSuccess[i].split(/,/);
        if (items.length > 3) { // 存在 hash // <host>,<path>,<file>,<hash>
          var key = items.slice(0, -1); // <host>,<path>,<file>
          if (dict[key]) {
            cachePostSuccess.splice(i, 1); // remove
          } else {
            dict[key] = true;
          }
        }
      }
    }
  }

  var to = options.to;
  var receiver = options.receiver;

  var steps = [];

  if (options.notify) { // 通知服务器处理状态
    steps.push(function(next) {
      upload(receiver, '#begin', '', '', {
        subpath: '#begin'
      }, function(error) {
        next();
      });
    });
  }

  modified.forEach(function(file) {
    var cacheHash;
    if (cachePostSuccessFile) { // 需要处理缓存
      // e.g. "http://127.0.0.1:8080/receiver,/home/public,/css/base.css"
      cacheHash = [receiver.replace(/\?.*$/, ''), to, file.getUrl()].join();
      if (!file.useHash) { // 如果文件名中没有使用 hash 则自动补上
        cacheHash += ',' + _.md5(file.getContent()); // file.getHash() 内容更新获取的还是同一个值
      }
      if (cachePostSuccess && cachePostSuccess.indexOf(cacheHash) >= 0) {
        var time = '[' + fis.log.now(true) + ']';
        process.stdout.write(
          ' - '.green.bold +
          time.grey + ' ' +
          file.subpath.replace(/^\//, '') +
          ' cached '.cyan.bold +
          to + file.getHashRelease() +
          '\n'
        );
        return;
      }
    }
    var reTryCount = options.retry;

    steps.push(function(next) {
      var _upload = arguments.callee;

      upload(receiver, to, file.getHashRelease(), file.getContent(), file, function(error) {
        if (error) {
          if (!--reTryCount) {
            throw new Error(error);
          } else {
            _upload();
          }
        } else {
          if (cachePostSuccessFile) { // 需要处理缓存
            // 记录已经提交成功的文件
            fs.appendFileSync(cachePostSuccessFile, cacheHash + '\n');
          }
          next();
        }
      });
    });
  });
  if (options.notify) { // 通知服务器处理状态
    steps.push(function(next) {
      upload(receiver, '#end', '', '', {
        subpath: '#end'
      }, function(error) {
        next();
      });
    });
  }

  _.reduceRight(steps, function(next, current) {
    return function() {
      current(next);
    };
  }, callback)();
};

module.exports.options = {
  // 允许重试两次。
  retry: 2
};