module.exports.init = function () {
    require('./main.model');
    require('./export.model');
    require('./fileMapper.model');
    require('./workflow.model');
    require('./fileTransfers.model');
    require('./softDeleted.model');
}