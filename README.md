# broke-gate-scripts

Pinned check code for the broke-gate plugin (release pre-submit checks + Label Engine driver).
The gate loads these through jsDelivr and refuses to run a file whose SHA-256 differs from the one pinned in the plugin, so changing a file here never changes what runs.
