"""Exercise the contents of an installable package, not merely its filename."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile


class VerifyCiVsixTests(unittest.TestCase):
    def setUp(self):
        module_path = Path(__file__).resolve().parents[2] / "tools" / "verify-ci-vsix.py"
        spec = importlib.util.spec_from_file_location("verify_ci_vsix", module_path)
        self.verifier = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.verifier)
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.archive = Path(self.directory.name) / "package.vsix"
        self.version = "0.1.52-pre+0000123"

    def package(self, package_version=None, xml_version=None, main="./dist/composition/extension.js", files=None):
        with zipfile.ZipFile(self.archive, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("extension/package.json", json.dumps({
                "version": package_version or self.version, "main": main
            }))
            archive.writestr("extension.vsixmanifest", (
                '<PackageManifest xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">'
                '<Metadata><Identity Version="' + (xml_version or self.version) + '" /></Metadata>'
                '</PackageManifest>'
            ))
            for file in files if files is not None else ["extension/dist/composition/extension.js"]:
                archive.writestr(file, "exports.activate = function () {};\n")

    def test_valid_package_preserves_build_metadata_in_both_manifests(self):
        self.package()
        self.verifier.verify(self.archive, self.version)

    def test_rejects_either_manifest_version_mismatch(self):
        for override in [{"package_version": "0.0.1-pre"}, {"xml_version": "0.1.52-pre"}]:
            with self.subTest(override=override):
                self.package(**override)
                with self.assertRaisesRegex(ValueError, "version"):
                    self.verifier.verify(self.archive, self.version)

    def test_rejects_missing_or_obsolete_activation_and_stale_modules(self):
        for override in [
            {"main": "./dist/t305-extension.js"},
            {"files": []},
            {"files": ["extension/dist/composition/extension.js", "extension/dist/t305-extension.js"]},
        ]:
            with self.subTest(override=override):
                self.package(**override)
                with self.assertRaises(ValueError):
                    self.verifier.verify(self.archive, self.version)


if __name__ == "__main__":
    unittest.main()
