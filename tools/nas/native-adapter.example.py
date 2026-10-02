"""DSM adapter contract: requires a supported, target-verified native source.

This explicit blocked example never reads NAS accounts or authorizes a file.
It must not be described as automatic DSM integration. No guessed SYNO.API
method, synouser output parser or service-account access check is provided.
"""


class NativeAdapter:
    def __init__(self, config):
        self.config = config

    def profile(self):
        # A real adapter supplies its exact verified source and capabilities.
        return {"dsmVersion": "unverified", "directorySourceId": "unverified", "authorizationSourceId": "unverified", "identityLifecycle": False,
                "effectiveAcl": False, "shareRestrictions": False, "sameObjectRead": False}

    def directory(self):
        raise RuntimeError("native-directory-unimplemented")

    def authorize(self, principal, target):
        raise RuntimeError("native-effective-acl-unimplemented")

    def open_authorized(self, principal, target):
        # A real implementation returns a context manager for (filefd, rootfd)
        # after native principal/ancestor/share checks on the pinned object.
        raise RuntimeError("native-authorized-read-unimplemented")
