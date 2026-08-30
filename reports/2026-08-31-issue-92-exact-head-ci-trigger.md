# Issue #92 exact-head CI trigger

This file records the connector-authored commit used to request the final pull-request CI after the implementation worker completed and removed its temporary automation.

The CI result is accepted only when the pull request current HEAD SHA and the workflow run `head_sha` are identical. A workflow run for any other SHA is not used as substitute evidence.
