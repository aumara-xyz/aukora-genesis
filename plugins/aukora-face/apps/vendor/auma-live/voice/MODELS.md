# The voice models are not in this repository

`sidecar.py` loads speech models from `models/` beside it. Those weights are about
711 MB and the virtual environment another 1.2 GB, so neither is committed: a
repository is not a model registry, and a clone should not cost two gigabytes to
read the source.

The application itself — the page, its scripts and the sidecar — is here and complete.
Without the weights the page loads and the sidecar refuses to start, which is the
honest behaviour: a voice app that silently does nothing is worse than one that says
it has no voice.

To run it locally, put the weights in `models/` and create the environment:

    bash setup.sh      # reads requirements.txt
    bash run.sh        # starts the sidecar

The original weights were preserved outside the Deep repository before that
repository could be deleted, in a private location outside this repository.

