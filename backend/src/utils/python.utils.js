const { execSync } = require('child_process');

/**
 * Robustly detects the available Python command on the system.
 * On Windows, it tries 'py -3', then 'python', then 'python3'.
 * On other platforms, it defaults to 'python3'.
 * @returns {string} The detected Python command.
 */
function getPythonCommand() {
    if (process.platform !== 'win32') {
        return 'python3';
    }

    // Windows detection logic
    const commands = ['py -3', 'python', 'python3'];

    for (const cmd of commands) {
        try {
            console.log(`[PythonUtility] Checking command: ${cmd}`);
            // Check if command exists and returns a version
            const version = execSync(`${cmd} --version`, { stdio: 'pipe', windowsHide: true }).toString().trim();

            if (version.toLowerCase().includes('python')) {
                // Double check by running a simple command
                execSync(`${cmd} -c "print('ok')"`, { stdio: 'pipe', windowsHide: true });
                console.log(`[PythonUtility] ✓ Functional python command: ${cmd} (${version})`);
                return cmd;
            } else {
                console.warn(`[PythonUtility] ⚠ Command ${cmd} returned unexpected version: ${version}`);
            }
        } catch (error) {
            const errorMsg = error.stderr ? error.stderr.toString().trim() : error.message;
            console.warn(`[PythonUtility] ✗ Command ${cmd} failed: ${errorMsg.slice(0, 100)}...`);
            continue;
        }
    }

    // Fallback if none are found
    console.error('[PythonUtility] ❌ FATAL: No functional python command detected on this system.');
    console.error('[PythonUtility] Please ensure Python is installed and added to your system PATH.');
    // We still return 'python' as a final attempt, which will likely fail with a clear OS error
    return 'python';
}

module.exports = {
    getPythonCommand
};
