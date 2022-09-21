# ds-base #

* Base image for data services.
* Service ID is required to generate the code during runtime.


# nodemon command

```
LOG_LEVEL=trace nodemon -i ./api/controllers/file.controller.js -i ./api/helpers/service.definition.js -i ./api/swagger/swagger.yaml -i ./api/utils/special-fields.utils.js -i ./hooks.json -i ./globalDef.json -i ./uploads -i ./.env -i ./service.json app.js 
```