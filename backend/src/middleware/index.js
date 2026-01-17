const authMiddleware = require('./auth.middleware');
const uploadMiddleware = require('./upload.middleware');
const { validate } = require('./validate.middleware');

module.exports = {
  ...authMiddleware,
  ...uploadMiddleware,
  validate
};
