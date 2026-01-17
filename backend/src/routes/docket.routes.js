const express = require('express');
const router = express.Router();
const docketController = require('../controllers/docket.controller');
const { verifyToken, requirePermission } = require('../middleware');

// All docket routes require specific permissions as per requirements
router.use(verifyToken);

router.post('/', requirePermission('dockets:create'), docketController.createDocket);
router.get('/', requirePermission('dockets:read'), docketController.getDockets);
router.get('/:id', requirePermission('dockets:read'), docketController.getDocket);
router.patch('/:id/status', requirePermission('dockets:update'), docketController.updateStatus);

module.exports = router;
