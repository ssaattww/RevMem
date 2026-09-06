"""Verify the identity and activation entry point inside a CI-built VSIX."""
import argparse
import json
from pathlib import PurePosixPath
import re
import sys
import xml.etree.ElementTree as ET
import zipfile


def verify(archive_path, expected_version):
    with zipfile.ZipFile(archive_path) as archive:
        package = json.loads(archive.read("extension/package.json"))
        if package.get("version") != expected_version:
            raise ValueError("Packaged package.json version does not match CI version.")
        manifest = ET.fromstring(archive.read("extension.vsixmanifest"))
        identity = manifest.find(".//{*}Identity")
        if identity is None or identity.get("Version") != expected_version:
            raise ValueError("VSIX Identity version does not match CI version.")
        if package.get("main") != "./dist/composition/extension.js":
            raise ValueError("Packaged activation must point to the production composition root.")
        names = archive.namelist()
        if "extension/dist/composition/extension.js" not in names:
            raise ValueError("Packaged activation module is missing.")
        obsolete = [name for name in names if name.startswith("extension/dist/")
                    and re.match(r"t-?\d{3}(?:-|\.)", PurePosixPath(name).name, re.IGNORECASE)]
        if obsolete:
            raise ValueError("Obsolete task-number production modules in VSIX: " + ", ".join(obsolete))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive")
    parser.add_argument("version")
    arguments = parser.parse_args()
    try:
        verify(arguments.archive, arguments.version)
    except (ValueError, KeyError, OSError, zipfile.BadZipFile, ET.ParseError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print(f"Verified VSIX version {arguments.version} and composition activation.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
