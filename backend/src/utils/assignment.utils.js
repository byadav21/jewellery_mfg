const { SystemSettings } = require('../models');

/**
 * Applies auto-assignment rules to job data based on the channel
 * @param {Object} jobData - The job data to be enriched
 * @param {String} channel - The order channel (amazon, ebay, etsy, manual)
 * @returns {Promise<Object>} - Enriched job data with assigned users
 */
const applyAutoAssignment = async (jobData, channel) => {
    try {
        const rules = await SystemSettings.getSetting('auto_assignment_rules');

        if (!rules || !rules[channel.toLowerCase()]) {
            return jobData;
        }

        const channelRules = rules[channel.toLowerCase()];
        const enrichedData = { ...jobData };

        // Assign CAD Designer if configured
        if (channelRules.cadDesigner && !enrichedData.cadDesigner) {
            enrichedData.cadDesigner = channelRules.cadDesigner;
            enrichedData.cadAssignedAt = new Date();
            if (enrichedData.status === 'new' && !enrichedData.cadRequired === false) {
                enrichedData.status = 'cad_assigned';
            }
        }

        // Assign Manufacturer if configured
        if (channelRules.manufacturer && !enrichedData.manufacturer) {
            enrichedData.manufacturer = channelRules.manufacturer;
            enrichedData.manufacturingAssignedAt = new Date();
            // Only change status if it wasn't already moved to cad_assigned, 
            // or if CAD is not required
            if (enrichedData.status === 'new' || enrichedData.cadRequired === false) {
                enrichedData.status = 'manufacturing_assigned';
            }
        }

        // Assign Admin if configured
        if (channelRules.admin && !enrichedData.admin) {
            enrichedData.admin = channelRules.admin;
        }

        // Assign Production Coordinator if configured
        if (channelRules.productionCoordinator && !enrichedData.productionCoordinator) {
            enrichedData.productionCoordinator = channelRules.productionCoordinator;
            enrichedData.productionCoordinatorAssignedAt = new Date();
        }

        return enrichedData;
    } catch (error) {
        console.error('Error applying auto-assignment:', error);
        return jobData;
    }
};

module.exports = {
    applyAutoAssignment
};
