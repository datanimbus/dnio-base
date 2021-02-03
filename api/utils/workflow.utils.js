const fs = require('fs');
const path = require('path');
const _ = require('lodash');

const config = require('../../config');

const logger = global.logger;
const configDB = global.authorDB;


/**
 * @returns {Promise<string[]>} Returns Array of userIds
 */
function getApproversList() {
    async function execute() {
        try {
            const roleIds = [];
            const role = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'role.json'), 'utf-8'));
            if (!role || role._id != config.serviceId || !role.roles || role.roles.length == 0) {
                return [];
            } else {
                role.roles.forEach(r => {
                    if (r.operations.find(o => o.method == 'REVIEW')) {
                        roleIds.push(r.id);
                    }
                });
                const groups = await configDB.collection('userMgmt.groups').find({ 'roles.id': { $in: roleIds } }).toArray();
                let usersArr = groups.map(g => g.users);
                return _.uniq([].concat.apply([], usersArr));
            }
        } catch (err) {
            logger.error('workflow.utils>getApproversList', err);
            return [];
        }
    }
    return execute().catch(err => {
        logger.error('workflow.utils>getApproversList', err);
        return [];
    })
};

/**
 * @returns {boolean} Returns true/false
 */
function isWorkflowEnabled() {
    let flag = false;
    try {
        const role = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'role.json'), 'utf-8'));
        if (!role || role._id != config.serviceId) {
            flag = false;
        } else {
            if (role.roles && role.roles.length > 0 && role.roles.find(r => r.operations.find(o => o.method == 'REVIEW'))) {
                flag = true;
            } else {
                flag = false;
            }
        }
    } catch (err) {
        logger.error('workflow.utils>isWorkflowEnabled', err);
        flag = false;
    }
    return flag;
};

/**
 * @returns {Promise<boolean>} Returns a boolean Promise
 */
function hasSkipReview(req) {
    async function execute() {
        try {
            const userId = req.headers[global.userHeader];
            if (!userId) {
                logger.debug('UserID not found in request');
                return false;
            }
            const roleIds = [];
            const role = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'role.json'), 'utf-8'));
            if (!role || role._id != config.serviceId || !role.roles || role.roles.length == 0) {
                return [];
            } else {
                role.roles.forEach(r => {
                    if (r.operations.find(o => o.method == 'SKIP_REVIEW')) {
                        roleIds.push(r.id);
                    }
                });
                const groups = await configDB.collection('userMgmt.groups').find({ 'roles.id': { $in: roleIds }, 'users': userId }).toArray();
                if (groups && groups.length > 0) {
                    return true;
                } else {
                    return false;
                }
            }
        } catch (err) {
            logger.error('workflow.utils>hasSkipReview', err);
            return [];
        }
    }
    return execute().catch(err => {
        logger.error('workflow.utils>hasSkipReview', err);
        return [];
    })
};

function getWorkflowItem(req, operation, _id, status, newDoc, oldDoc) {
    return {
        serviceId: config.serviceId,
        documentId: _id,
        operation: operation,
        requestedBy: req.headers[global.userHeader],
        app: req.body.app,
        audit: [],
        status: status,
        data: {
            old: oldDoc ? (oldDoc) : null,
            new: newDoc ? (newDoc) : null,
        }
    };
};

module.exports.getApproversList = getApproversList;
module.exports.isWorkflowEnabled = isWorkflowEnabled;
module.exports.hasSkipReview = hasSkipReview;
module.exports.getWorkflowItem = getWorkflowItem;