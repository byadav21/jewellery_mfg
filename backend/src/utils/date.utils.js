/**
 * Date utility for business hour calculations
 */

/**
 * Adds business hours to a date, skipping non-working hours and holidays (Sundays)
 * 
 * @param {Date} startDate - The starting date
 * @param {number} hoursToAdd - Number of business hours to add
 * @param {Object} options - Configuration for business hours
 * @returns {Date} The calculated deadline
 */
const addBusinessHours = (startDate, hoursToAdd, options = {}) => {
    const {
        startHour = 9,      // 9 AM
        endHour = 18,       // 6 PM
        workDays = [1, 2, 3, 4, 5, 6], // Mon-Sat
    } = options;

    let currentDate = new Date(startDate);
    let remainingHours = hoursToAdd;

    // Function to check if a date is a work day
    const isWorkDay = (date) => workDays.includes(date.getDay());

    // Function to check if a date is within work hours
    const isWithinWorkHours = (date) => {
        const hour = date.getHours();
        return hour >= startHour && hour < endHour;
    };

    while (remainingHours > 0) {
        // 1. Move to next business hour
        currentDate.setHours(currentDate.getHours() + 1);
        currentDate.setMinutes(0);
        currentDate.setSeconds(0);
        currentDate.setMilliseconds(0);

        // 2. If it's the end of the day or a weekend, move to the next work day morning
        if (currentDate.getHours() >= endHour || !isWorkDay(currentDate)) {
            currentDate.setDate(currentDate.getDate() + 1);
            currentDate.setHours(startHour);

            // Keep moving days until we find a work day
            while (!isWorkDay(currentDate)) {
                currentDate.setDate(currentDate.getDate() + 1);
            }
        }

        // 3. Count this hour as consumed
        remainingHours--;
    }

    return currentDate;
};

/**
 * Calculates remaining business hours between two dates
 * 
 * @param {Date} start - Current date
 * @param {Date} end - Deadline date
 * @returns {number} - Remaining business hours
 */
const getRemainingBusinessHours = (start, end, options = {}) => {
    const {
        startHour = 9,
        endHour = 18,
        workDays = [1, 2, 3, 4, 5, 6],
    } = options;

    if (start >= end) return 0;

    let count = 0;
    let current = new Date(start);

    const isWorkDay = (date) => workDays.includes(date.getDay());

    while (current < end) {
        if (isWorkDay(current)) {
            const hour = current.getHours();
            if (hour >= startHour && hour < endHour) {
                count++;
            }
        }
        current.setHours(current.getHours() + 1);
    }

    return count;
};

module.exports = {
    addBusinessHours,
    getRemainingBusinessHours
};
