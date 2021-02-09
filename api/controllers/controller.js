'use strict';
//controllers
const SRVC2006Controller = require('./srvc2006.controller.js');
// const logsController = require("./logs.controller.js");
const preHooksController = require('./preHooks.controller.js');
// const webHookStatusController = require("./webHookStatus.controller.js");
const bulkUploadController = require('./bulkUpload.controller.js');

//exports
var exports = {};
exports.v1_srvc2006Create = SRVC2006Controller.create;
exports.v1_srvc2006List = SRVC2006Controller.index;
exports.v1_srvc2006Export = SRVC2006Controller.exportAll;
exports.v1_srvc2006ExportDetailsCount = SRVC2006Controller.exportDetailsCount;
exports.v1_srvc2006ExportDetailsDelete = SRVC2006Controller.exportDetailsDelete;
exports.v1_srvc2006ExportDetails = SRVC2006Controller.exportDetails;
exports.v1_srvc2006Show = SRVC2006Controller.show;
exports.v1_srvc2006Destroy = SRVC2006Controller.destroy;
exports.v1_srvc2006Update = SRVC2006Controller.update;
exports.v1_srvc2006Math = SRVC2006Controller.math;
exports.v1_srvc2006Count = SRVC2006Controller.count;
exports.v1_srvc2006Hook = preHooksController.triggerHook;
exports.v1_srvc2006BulkShow = SRVC2006Controller.bulkShow;
exports.v1_srvc2006BulkDelete = SRVC2006Controller.bulkDelete;
exports.v1_srvc2006FileUpload = SRVC2006Controller.fileUpload;
exports.v1_srvc2006FileView = SRVC2006Controller.fileView;
exports.v1_srvc2006FileDownload = SRVC2006Controller.fileDownload;
exports.v1_srvc2006ExportedFileDownload = SRVC2006Controller.exportedFileDownload;
exports.v1_srvc2006Doc = SRVC2006Controller.doc;
exports.v1_srvc2006HealthCheck = SRVC2006Controller.healthCheck;
exports.v1_srvc2006ReadinessCheck = SRVC2006Controller.readiness;
exports.v1_srvc2006Simulate = SRVC2006Controller.simulate;
exports.v1_srvc2006LockDocument = SRVC2006Controller.lockDocument;
exports.v1_srvc2006ExperienceHook = SRVC2006Controller.experienceHookData;
exports.v1_srvc2006SecuredFields = SRVC2006Controller.securedFields;
// exports.v1_logsIndex = logsController.index;
// exports.v1_logsControllerCount = logsController.count;
// exports.v1_webHookStatusIndex = webHookStatusController.index;
// exports.v1_webHookStatusCount = webHookStatusController.count;
exports.v1_mapping = bulkUploadController.validateData;
exports.v1_enrichData = bulkUploadController.enrichData;
exports.v1_enrichDataForWF = bulkUploadController.enrichDataForWF;
exports.v1_bulkCreate = bulkUploadController.bulkCreate;
exports.fileMapperCount = bulkUploadController.fileMapperCount;
exports.fileMapperList = bulkUploadController.fileMapperList;
exports.v1_aggregate = SRVC2006Controller.aggregate;
exports.v1_updateHref = SRVC2006Controller.updateHref;


module.exports = exports;
