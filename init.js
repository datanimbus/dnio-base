const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const _ = require('lodash');
const cron = require('node-cron');

const config = require('./config');
const httpClient = require('./http-client');
const controller = require('./api/utils/common.utils');
const rolesUtils = require('./api/utils/roles.utils');
const hooksUtils = require('./api/utils/hooks.utils');

const fileFields = ''.split(',');
const logger = global.logger;
function init() {
  try {
    if (!fs.existsSync(path.join(process.cwd(), 'hooks.json'))) {
      fs.writeFileSync(path.join(process.cwd(), 'hooks.json'), '{"preHooks":[],"experienceHooks":[]}', 'utf-8');
    }
  } catch (e) {
    logger.error(e);
  }
  return controller.fixSecureText()
    .then(() => informSM())
    .then(() => rolesUtils.getRoles())
    .then(() => hooksUtils.getHooks())
}

function getFileNames(doc, field) {
    if (!doc) return [];
    let fArr = field.split('.');
    if (fArr.length === 1) {
        if (Array.isArray(doc[fArr])) {
            return doc[fArr].map(_d => _d.filename);
        } else if (doc[fArr] && typeof doc[fArr] === 'object') {
            return [doc[fArr]['filename']]
        }
    }
    let key = fArr.shift();
    if (doc && doc[key]) {
        if (Array.isArray(doc[key])) {
            let arr = doc[key].map(_d => {
                return getFileNames(_d, fArr.join('.'));
            });
            return [].concat.apply([], arr);
        }
        else if (doc[key] && typeof doc[key] === 'object') {
            return getFileNames(doc[key], fArr.join('.'))
        }
    }
}

function startCronJob() {
    cron.schedule('15 2 * * *', clearUnusedFiles)
}
startCronJob()

async function clearUnusedFiles() {
    const batch = 1000;
    logger.info('Cron triggered to clear unused file attachment')
    const datefilter = new Date(new Date().getTime() - 24 * 60 * 60 * 1000);
    const count = await mongoose.connection.db.collection(`${config.serviceCollection}.files`).count({ 'uploadDate': { '$lte': datefilter } }, { filename: 1 });
    let arr = [];
    let totalBatchCount = count / batch;
    for (let i = 0; i < totalBatchCount; i++) {
        arr.push(i);
    }
    async function reduceHandler(acc, curr, i) {
        const status = await acc;
        let docs = await mongoose.connection.db.collection(`${config.serviceCollection}.files`).find({ 'uploadDate': { '$lte': datefilter } }, { filename: 1 }).limit(batch).skip(i * batch).toArray();
        let allFilename = docs.map(_d => _d.filename);
        let fileInUse = [];
        docs = await mongoose.model(`${config.serviceCollection}`).find({}, fileFields.join(' '));
        docs.forEach(_d => {
            fileFields.forEach(_k => {
                fileInUse = fileInUse.concat(getFileNames(_d, _k));
            })
        });
        docs = await global.mongoDBLogs.collection(`${config.serviceCollection}.audit`).find({ 'data.old': { $exists: true } }, 'data').toArray();
        docs.forEach(_d => {
            if (_d.data && _d.data.old) {
                fileFields.forEach(_k => {
                    fileInUse = fileInUse.concat(getFileNames(_d.data.old, _k));
                })
            }
        })
        fileInUse = fileInUse.filter(_f => _f);
        logger.info({ fileInUse });
        let filesToBeDeleted = _.difference(allFilename, fileInUse);
        logger.info({ filesToBeDeleted });
        let promise = filesToBeDeleted.map(_f => deleteFileFromDB(_f));
        return Promise.all(promise);
    }
    return arr.reduce(reduceHandler, Promise.resolve())
}

function deleteFileFromDB(filename) {
    let gfsBucket = global.gfsBucket;
    return new Promise((resolve, reject) => {
        gfsBucket.find({
            filename: filename
        }).toArray(function (err, result) {
            if (err) {
                logger.error(err);
                reject(err);
            } else {
                gfsBucket.delete(result[0]._id, function (err) {
                    if (err) {
                        logger.error(err);
                        return reject(err);
                    } else {
                        logger.info('Removed file ' + filename);
                        resolve(filename);
                    }
                })
            }
        });
    })
}

async function informSM() {
    logger.trace(`Ping SM service`);
    const options = {
        url: config.baseUrlSM + '/service/' + config.serviceId + '/statusChange',
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        qs: {
            status: 'Active'
        },
        json: true
    };
    return httpClient.httpRequest(options).then(res => {
      if (res.statusCode === 200) {
          let maintenanceInfo = null;
          const body = res.body;
          if (body.status == 'Maintenance') {
          		logger.info(`Service going into maintenance mode!`)
          		logger.info(`Maintenance mode :: data :: ${JSON.stringify(maintenanceInfo)}`)
              global.status = 'Maintenance';
              if (body.maintenanceInfo) {
                  maintenanceInfo = JSON.parse(body.maintenanceInfo);
                  let type = maintenanceInfo.type;
                  logger.info(`Maintenance type :: ${type}`)
                  if (type == 'purge') {
                  		logger.info(`Maintenance mode :: related service :: ${JSON.stringify(body.relatedService)}`)
                      return controller.bulkDelete(body.relatedService);
                  }
              }
          }
          if (body.outgoingAPIs) {
              logger.trace(`Outgoing APIs - ${JSON.stringify({ outgoingAPIs: body.outgoingAPIs })}`);
              global.outgoingAPIs = body.outgoingAPIs;
          }
      } else {
          throw new Error('Service not found');
      }
    }).catch(err => {
        logger.error(`Error pinging service-manager :: ${err.message}`)
    });
}
module.exports = init;