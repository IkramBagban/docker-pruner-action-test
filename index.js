const core = require('@actions/core');
const { exec } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

(async () => {
  try {
    const host = core.getInput('host');
    const username = core.getInput('username');
    const key = core.getInput('key');

    // Save SSH key to a temporary file
    const keyPath = path.join(os.tmpdir(), 'vm_key.pem');
    fs.writeFileSync(keyPath, key + '\n', { mode: 0o600 });

    const command = `ssh -i ${keyPath} -o StrictHostKeyChecking=no ${username}@${host} "docker system prune -af"`;

    core.info(`Running: ${command}`);

    exec(command, (error, stdout, stderr) => {
      if (error) {
        core.setFailed(`SSH Command Failed: ${error.message}`);
        return;
      }
      core.info(`STDOUT: ${stdout}`);
      if (stderr) core.warning(`STDERR: ${stderr}`);
    });
  } catch (error) {
    core.setFailed(error.message);
  }
})();
