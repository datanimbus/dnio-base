var definition = {
  _id: { type: 'String' },
  name: { type: "String" },
  url: { type: "String" },
  user: { type: 'String', },
  txnId: { type: 'String', },
  status: { 
  	type: 'String',
    enum: ['Initiated', 'Completed', 'Error']
  },
  errorMessage: { type: 'String', },
  retry: { type: 'Number', default: 0},
  operartion: {
    type: 'String',
    enum: ['POST', 'PUT', 'DELETE']
  }
  type: {
    type: 'String',
    enum: ['PreHook', 'PostHook']
  },
  trigger: {
  	source: { type: "String", },
  	simulate: { type: "Boolean", default: false},
  },
  service: {
  	id: { type: "String", },
  	name: { type: "String", }
  }
  headers: { type: 'Object', },
  properties: { type: 'Object' }
  data: { type: 'Object', },
  _metadata: {
    createdAt: {
      type: 'Date'
    },
    lastUpdated: {
      type: 'Date'
    }
  },
};
module.exports.definition = definition;