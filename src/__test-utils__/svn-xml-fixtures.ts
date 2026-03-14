/**
 * SVN XML Response Fixtures for Testing
 *
 * Provides sample SVN XML responses for parsing tests.
 * These match real SVN output format for accurate testing.
 */

export const SVN_STATUS_XML = {
  empty: `<?xml version="1.0" encoding="UTF-8"?>
<status>
<target
   path="/test/repo">
</target>
</status>`,

  singleModified: `<?xml version="1.0" encoding="UTF-8"?>
<status>
<target
   path="/test/repo">
<entry
   path="modified.txt">
<wc-status
   item="modified"
   revision="5"
   props="none">
<commit
   revision="3">
<author>testuser</author>
<date>2024-01-01T12:00:00.000000Z</date>
</commit>
</wc-status>
</entry>
</target>
</status>`,

  multipleEntries: `<?xml version="1.0" encoding="UTF-8"?>
<status>
<target
   path="/test/repo">
<entry
   path="added.txt">
<wc-status
   item="added"
   revision="-1"
   props="none">
</wc-status>
</entry>
<entry
   path="modified.txt">
<wc-status
   item="modified"
   revision="5"
   props="none">
<commit
   revision="3">
<author>user1</author>
<date>2024-01-01T12:00:00.000000Z</date>
</commit>
</wc-status>
</entry>
<entry
   path="untracked.txt">
<wc-status
   item="unversioned"
   revision="-1"
   props="none">
</wc-status>
</entry>
<entry
   path="conflicted.txt">
<wc-status
   item="conflicted"
   revision="5"
   props="none">
<commit
   revision="4">
<author>user2</author>
<date>2024-01-02T12:00:00.000000Z</date>
</commit>
</wc-status>
</entry>
</target>
</status>`,

  withLock: `<?xml version="1.0" encoding="UTF-8"?>
<status>
<target
   path="/test/repo">
<entry
   path="locked.txt">
<wc-status
   item="normal"
   revision="5"
   props="none">
<commit
   revision="5">
<author>testuser</author>
<date>2024-01-01T12:00:00.000000Z</date>
</commit>
<lock>
<owner>lockuser</owner>
<comment>Locked for editing</comment>
<date>2024-01-02T12:00:00.000000Z</date>
</lock>
</wc-status>
</entry>
</target>
</status>`,

  directory: `<?xml version="1.0" encoding="UTF-8"?>
<status>
<target
   path="/test/repo">
<entry
   path="subdir">
<wc-status
   item="normal"
   revision="5"
   props="none">
<commit
   revision="2">
<author>testuser</author>
<date>2024-01-01T12:00:00.000000Z</date>
</commit>
</wc-status>
</entry>
</target>
</status>`,

  deleted: `<?xml version="1.0" encoding="UTF-8"?>
<status>
<target
   path="/test/repo">
<entry
   path="deleted.txt">
<wc-status
   item="deleted"
   revision="5"
   props="none">
<commit
   revision="4">
<author>testuser</author>
<date>2024-01-01T12:00:00.000000Z</date>
</commit>
</wc-status>
</entry>
</target>
</status>`,

  replaced: `<?xml version="1.0" encoding="UTF-8"?>
<status>
<target
   path="/test/repo">
<entry
   path="replaced.txt">
<wc-status
   item="replaced"
   revision="5"
   props="none">
<commit
   revision="5">
<author>testuser</author>
<date>2024-01-01T12:00:00.000000Z</date>
</commit>
</wc-status>
</entry>
</target>
</status>`,

  external: `<?xml version="1.0" encoding="UTF-8"?>
<status>
<target
   path="/test/repo">
<entry
   path="external">
<wc-status
   item="external"
   revision="-1"
   props="none">
</wc-status>
</entry>
</target>
</status>`,
};

export const SVN_LOG_XML = {
  empty: `<?xml version="1.0" encoding="UTF-8"?>
<log>
</log>`,

  singleEntry: `<?xml version="1.0" encoding="UTF-8"?>
<log>
<logentry
   revision="1">
<author>testuser</author>
<date>2024-01-01T12:00:00.000000Z</date>
<msg>Initial commit</msg>
<paths>
<path
   action="A"
   kind="dir">/trunk</path>
</paths>
</logentry>
</log>`,

  multipleEntries: `<?xml version="1.0" encoding="UTF-8"?>
<log>
<logentry
   revision="3">
<author>user2</author>
<date>2024-01-03T12:00:00.000000Z</date>
<msg>Third commit

Multiple lines
of message</msg>
<paths>
<path
   action="M"
   kind="file">/trunk/file.txt</path>
</paths>
</logentry>
<logentry
   revision="2">
<author>user1</author>
<date>2024-01-02T12:00:00.000000Z</date>
<msg>Second commit</msg>
<paths>
<path
   action="A"
   kind="file">/trunk/file.txt</path>
</paths>
</logentry>
<logentry
   revision="1">
<author>user1</author>
<date>2024-01-01T12:00:00.000000Z</date>
<msg>Initial commit</msg>
<paths>
<path
   action="A"
   kind="dir">/trunk</path>
</paths>
</logentry>
</log>`,

  withCopyFrom: `<?xml version="1.0" encoding="UTF-8"?>
<log>
<logentry
   revision="5">
<author>testuser</author>
<date>2024-01-05T12:00:00.000000Z</date>
<msg>Branch created</msg>
<paths>
<path
   action="A"
   kind="dir"
   copyfrom-path="/trunk"
   copyfrom-rev="4">/branches/feature</path>
</paths>
</logentry>
</log>`,

  noAuthor: `<?xml version="1.0" encoding="UTF-8"?>
<log>
<logentry
   revision="1">
<date>2024-01-01T12:00:00.000000Z</date>
<msg>Commit without author</msg>
<paths>
<path
   action="A"
   kind="dir">/trunk</path>
</paths>
</logentry>
</log>`,
};

export const SVN_INFO_XML = {
  basic: `<?xml version="1.0" encoding="UTF-8"?>
<info>
<entry
   path="/test/repo"
   revision="5"
   kind="dir">
<url>https://svn.example.com/repo/trunk</url>
<relative-url>^/trunk</relative-url>
<repository>
<root>https://svn.example.com/repo</root>
<uuid>12345678-1234-1234-1234-123456789012</uuid>
</repository>
<wc-info>
<wcroot-abspath>/test/repo</wcroot-abspath>
<schedule>normal</schedule>
<depth>infinity</depth>
</wc-info>
<commit
   revision="5">
<author>testuser</author>
<date>2024-01-01T12:00:00.000000Z</date>
</commit>
</entry>
</info>`,

  file: `<?xml version="1.0" encoding="UTF-8"?>
<info>
<entry
   path="file.txt"
   revision="5"
   kind="file">
<url>https://svn.example.com/repo/trunk/file.txt</url>
<relative-url>^/trunk/file.txt</relative-url>
<repository>
<root>https://svn.example.com/repo</root>
<uuid>12345678-1234-1234-1234-123456789012</uuid>
</repository>
<wc-info>
<wcroot-abspath>/test/repo</wcroot-abspath>
<schedule>normal</schedule>
<depth>infinity</depth>
</wc-info>
<commit
   revision="3">
<author>user1</author>
<date>2024-01-01T10:00:00.000000Z</date>
</commit>
</entry>
</info>`,

  withLock: `<?xml version="1.0" encoding="UTF-8"?>
<info>
<entry
   path="locked.txt"
   revision="5"
   kind="file">
<url>https://svn.example.com/repo/trunk/locked.txt</url>
<relative-url>^/trunk/locked.txt</relative-url>
<repository>
<root>https://svn.example.com/repo</root>
<uuid>12345678-1234-1234-1234-123456789012</uuid>
</repository>
<wc-info>
<wcroot-abspath>/test/repo</wcroot-abspath>
<schedule>normal</schedule>
<depth>infinity</depth>
</wc-info>
<commit
   revision="5">
<author>testuser</author>
<date>2024-01-01T12:00:00.000000Z</date>
</commit>
<lock>
<token>opaquelocktoken:12345678-1234-1234-1234-123456789012</token>
<owner>lockuser</owner>
<comment>Locked for editing</comment>
<date>2024-01-02T12:00:00.000000Z</date>
</lock>
</entry>
</info>`,

  remoteUrl: `<?xml version="1.0" encoding="UTF-8"?>
<info>
<entry
   path="https://svn.example.com/repo/trunk"
   revision="5"
   kind="dir">
<url>https://svn.example.com/repo/trunk</url>
<relative-url>^/trunk</relative-url>
<repository>
<root>https://svn.example.com/repo</root>
<uuid>12345678-1234-1234-1234-123456789012</uuid>
</repository>
<commit
   revision="5">
<author>testuser</author>
<date>2024-01-01T12:00:00.000000Z</date>
</commit>
</entry>
</info>`,
};

export const SVN_LIST_XML = {
  empty: `<?xml version="1.0" encoding="UTF-8"?>
<lists>
<list
   path="https://svn.example.com/repo/trunk"
   rev="5">
</list>
</lists>`,

  basic: `<?xml version="1.0" encoding="UTF-8"?>
<lists>
<list
   path="https://svn.example.com/repo/trunk"
   rev="5">
<entry
   kind="dir">
<name>src</name>
<size>0</size>
<commit
   revision="5">
<author>testuser</author>
<date>2024-01-01T12:00:00.000000Z</date>
</commit>
</entry>
<entry
   kind="file">
<name>README.md</name>
<size>1024</size>
<commit
   revision="3">
<author>user1</author>
<date>2024-01-01T10:00:00.000000Z</date>
</commit>
</entry>
</list>
</lists>`,

  nested: `<?xml version="1.0" encoding="UTF-8"?>
<lists>
<list
   path="https://svn.example.com/repo/trunk/src"
   rev="5">
<entry
   kind="dir">
<name>components</name>
<size>0</size>
<commit
   revision="4">
<author>user1</author>
<date>2024-01-02T12:00:00.000000Z</date>
</commit>
</entry>
<entry
   kind="file">
<name>index.ts</name>
<size>512</size>
<commit
   revision="5">
<author>testuser</author>
<date>2024-01-03T12:00:00.000000Z</date>
</commit>
</entry>
</list>
</lists>`,
};

export const SVN_BLAME_XML = {
  basic: `<?xml version="1.0" encoding="UTF-8"?>
<blame>
<target
   path="file.txt">
<entry
   line-number="1">
<commit
   revision="1">
<author>user1</author>
<date>2024-01-01T12:00:00.000000Z</date>
</commit>
first line
</entry>
<entry
   line-number="2">
<commit
   revision="2">
<author>user2</author>
<date>2024-01-02T12:00:00.000000Z</date>
</commit>
second line
</entry>
</target>
</blame>`,

  withMerge: `<?xml version="1.0" encoding="UTF-8"?>
<blame>
<target
   path="merged.txt">
<entry
   line-number="1">
<commit
   revision="1">
<author>user1</author>
<date>2024-01-01T12:00:00.000000Z</date>
</commit>
original line
</entry>
<entry
   line-number="2"
   merged="true">
<commit
   revision="5">
<author>merger</author>
<date>2024-01-05T12:00:00.000000Z</date>
<merged-from>https://svn.example.com/repo/branches/feature@4</merged-from>
</commit>
merged line
</entry>
</target>
</blame>`,
};

export const SVN_PROPLIST_XML = {
  basic: `<?xml version="1.0" encoding="UTF-8"?>
<properties>
<target
   path="/test/repo">
<property
   name="svn:ignore">
*.o
*.obj
</property>
<property
   name="svn:externals">
external https://svn.example.com/external
</property>
</target>
</properties>`,

  empty: `<?xml version="1.0" encoding="UTF-8"?>
<properties>
<target
   path="/test/repo">
</target>
</properties>`,
};

/**
 * Raw SVN command output (non-XML) for testing CLI parsing
 */
export const SVN_RAW_OUTPUT = {
  checkout: `A    /test/repo/trunk
A    /test/repo/trunk/file.txt
 U   /test/repo/trunk
Checked out revision 5.`,

  update: `Updating '/test/repo':
A    newfile.txt
U    modified.txt
D    deleted.txt
Updated to revision 6.`,

  commit: `Sending        modified.txt
Transmitting file data .done
Committing transaction...
Committed revision 7.`,

  merge: `--- Merging r3 into '/test/repo':
U    file.txt
A    new.txt
--- Recording mergeinfo for merge of r3 into '/test/repo':
 U   .`,

  conflict: `C    conflicted.txt`,

  error: `svn: E155007: '/path/to/file' is not a working copy`,

  authFailed: `svn: E170013: Unable to connect to a repository at URL 'https://svn.example.com/repo'
svn: E215004: Authentication failed`,

  sslError: `svn: E175002: Unable to connect to a repository at URL 'https://svn.example.com/repo'
svn: E230001: Server SSL certificate verification failed: certificate has expired`,
};
