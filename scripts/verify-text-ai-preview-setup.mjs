import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const FAILURE_MESSAGE = 'Setup policy failed';
const MAX_SOURCE_BYTES = 1_048_576;
const SETUP_SOURCE_PREFIX = 'text-ai-preview-setup';

export const EXPECTED_FILES = Object.freeze([
  'scripts/text-ai-preview-setup-values.mjs',
  'scripts/text-ai-preview-setup-prompt.mjs',
  'scripts/text-ai-preview-setup-cloudflare.mjs',
  'scripts/text-ai-preview-setup-github.mjs',
  'scripts/text-ai-preview-setup.mjs',
]);
const EXPECTED_TEST_NAMES = Object.freeze(EXPECTED_FILES.map((file) => (
  `${basename(file, '.mjs')}.test.mjs`
)));

const EXPECTED_DIGESTS = Object.freeze({
  'scripts/text-ai-preview-setup-values.mjs': '5ac51ec36f81ccc1efd680bf9332dbdc44d5bc8804d47dd68a5b272fd25d50a3',
  'scripts/text-ai-preview-setup-prompt.mjs': 'eb04f7afe0dc9566c7d06b1c2595e16c4cf59005b567a380186902fe061a5c32',
  'scripts/text-ai-preview-setup-cloudflare.mjs': '831de9f780abbe8e83ca9e804075c87baa744222421755dff40bedd9ad71d90c',
  'scripts/text-ai-preview-setup-github.mjs': '51c570183adda081bcce75383970dd71aa54c1e5ed46f27d22b5e8fa52dca76e',
  'scripts/text-ai-preview-setup.mjs': '11e30f582b0a61f99b77140073eb307bdb13238eba39a98b1c743818fd1e73d0',
});

const FIXED_REPORT = Object.freeze({
  fourInputs: true,
  stdinOnlySecrets: true,
  firstRunOnly: true,
  deploymentDisabled: true,
  modelCalls: 0,
});
const FIXED_JSON = '{"fourInputs":true,"stdinOnlySecrets":true,"firstRunOnly":true,"deploymentDisabled":true,"modelCalls":0}';

const FORBIDDEN = /\b(?:wrangler|deploy|enable)\b|\bpages\s+deploy\b|deploy-disabled|enable-admin-preview|enable-account|\/api\/nutrition\/text\/(?:session|estimate)|shell:\s*true|--body|(?<!\.)\b(?:eval|exec)\s*\(|\b(?:curl|wget)\b|\b(?:writeFile|createWriteStream)\b|process\.env\.(?:ARK_API_KEY|CLOUDFLARE_API_TOKEN)|console\.(?:log|dir|table)/u;
const EXTRA_EXECUTABLE_FAMILY = /\b(?:python(?:3)?|ruby|perl|php|java|bash|zsh|fish|powershell|pwsh|npx)\b|\bnpm\s+exec\b|\bnode\s+(?:--input-type=module\s+)?-e\b/u;
const FORBIDDEN_PROCESS_API = /\b(?:spawnSync|execFile|execFileSync|fork)\b|\b(?:Bun\.spawn|Deno\.Command)\b/u;
const FORBIDDEN_FILESYSTEM_API = /from\s+['"]node:fs(?:\/promises)?['"]|\b(?:appendFile|openSync|writeSync|writeFileSync|createWriteStream)\b/u;

const PROMPT_LABEL_BLOCK = `const PROMPT_LABELS = new Set([
  'Cloudflare API Token',
  'ARK_API_KEY',
  'user-1 email',
  'user-2 email',
  'Continue? [y/N]',
]);`;
const FOUR_INPUT_BLOCK = `    for (const [label, hidden] of [
      ['Cloudflare API Token', true],
      ['ARK_API_KEY', true],
      ['user-1 email', false],
      ['user-2 email', false],
    ]) {`;
const SECRET_POLICY_BLOCK = `  secretNames: Object.freeze([
    'CLOUDFLARE_API_TOKEN',
    'ARK_API_KEY',
    'PHOTO_AI_CACHE_AES_KEY',
    'PHOTO_AI_ACCOUNT_HMAC_KEY',
    'TEXT_AI_USER_1_EMAIL',
    'TEXT_AI_USER_2_EMAIL',
    'TEXT_AI_ADMIN_EMAIL',
    'TEXT_AI_CF_ACCESS_CLIENT_ID',
    'TEXT_AI_CF_ACCESS_CLIENT_SECRET',
  ]),`;
const SECRET_WRITE_BLOCK = `    const secrets = Object.freeze([
      entry('CLOUDFLARE_API_TOKEN', inputs.cloudflareApiToken),
      entry('ARK_API_KEY', inputs.arkApiKey),
      entry('PHOTO_AI_CACHE_AES_KEY', keys.aesKey),
      entry('PHOTO_AI_ACCOUNT_HMAC_KEY', keys.hmacKey),
      entry('TEXT_AI_USER_1_EMAIL', inputs.user1Email),
      entry('TEXT_AI_USER_2_EMAIL', inputs.user2Email),
      entry('TEXT_AI_ADMIN_EMAIL', inputs.user1Email),
      entry('TEXT_AI_CF_ACCESS_CLIENT_ID', args.serviceClientId),
      entry('TEXT_AI_CF_ACCESS_CLIENT_SECRET', args.serviceClientSecret),
    ]);`;
const SUCCESS_OUTPUT = "const SUCCESS_OUTPUT = 'SETUP COMPLETE\\nsecrets=9 variables=2 preflight=pass workerTextEnabled=false photoEnabled=false\\n';";

function fail() {
  throw new Error(FAILURE_MESSAGE);
}

function countOccurrences(value, needle) {
  if (typeof value !== 'string' || typeof needle !== 'string' || needle.length === 0) fail();
  let count = 0;
  let offset = 0;
  while (true) {
    const next = value.indexOf(needle, offset);
    if (next === -1) return count;
    count += 1;
    offset = next + needle.length;
  }
}

function requireCount(source, snippet, expected = 1) {
  if (countOccurrences(source, snippet) !== expected) fail();
}

function isIdentifier(node, name) {
  return ts.isIdentifier(node) && node.text === name;
}

function hasOnlyModifier(node, kind) {
  return node.modifiers?.length === 1 && node.modifiers[0].kind === kind;
}

function hasNoModifiers(node) {
  return node.modifiers === undefined || node.modifiers.length === 0;
}

function collectAstNodes(root, predicate) {
  const result = [];
  const visit = (node) => {
    if (predicate(node)) result.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return result;
}

function isFailStatement(node) {
  return (
    ts.isExpressionStatement(node)
    && ts.isCallExpression(node.expression)
    && isIdentifier(node.expression.expression, 'fail')
    && node.expression.arguments.length === 0
    && node.expression.questionDotToken === undefined
  );
}

function requireIdentifierParameter(parameter, name, initializerName = null) {
  if (
    !isIdentifier(parameter.name, name)
    || parameter.dotDotDotToken !== undefined
    || parameter.questionToken !== undefined
    || parameter.type !== undefined
    || !hasNoModifiers(parameter)
  ) fail();
  if (initializerName === null) {
    if (parameter.initializer !== undefined) fail();
  } else if (!isIdentifier(parameter.initializer, initializerName)) fail();
  return parameter.name;
}

function findOnlyTopLevelFunction(sourceFile, name) {
  const matches = sourceFile.statements.filter((statement) => (
    ts.isFunctionDeclaration(statement) && isIdentifier(statement.name, name)
  ));
  if (matches.length !== 1) fail();
  return matches[0];
}

function isStrictStringRejection(node, identifierName, stringValue) {
  return (
    ts.isBinaryExpression(node)
    && node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken
    && isIdentifier(node.left, identifierName)
    && ts.isStringLiteral(node.right)
    && node.right.text === stringValue
  );
}

function isWithin(node, ancestor) {
  let current = node.parent;
  while (current !== undefined) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

function verifySpawnOptions(node) {
  if (!ts.isObjectLiteralExpression(node) || node.properties.length !== 3) fail();
  const [shellProperty, stdioProperty, envProperty] = node.properties;
  if (
    !ts.isPropertyAssignment(shellProperty)
    || !isIdentifier(shellProperty.name, 'shell')
    || shellProperty.initializer.kind !== ts.SyntaxKind.FalseKeyword
    || !ts.isPropertyAssignment(stdioProperty)
    || !isIdentifier(stdioProperty.name, 'stdio')
    || !ts.isArrayLiteralExpression(stdioProperty.initializer)
    || stdioProperty.initializer.elements.length !== 3
    || stdioProperty.initializer.elements.some((element) => (
      !ts.isStringLiteral(element) || element.text !== 'pipe'
    ))
    || !ts.isShorthandPropertyAssignment(envProperty)
    || !isIdentifier(envProperty.name, 'env')
    || envProperty.objectAssignmentInitializer !== undefined
  ) fail();
}

function verifyBoundedRunnerFunction(sourceFile, checker) {
  const runner = findOnlyTopLevelFunction(sourceFile, 'createBoundedCommandRunner');
  if (
    !hasNoModifiers(runner)
    || runner.asteriskToken !== undefined
    || runner.typeParameters !== undefined
    || runner.type !== undefined
    || runner.parameters.length !== 1
    || runner.body === undefined
    || runner.body.statements.length !== 2
  ) fail();
  const parameterReference = requireIdentifierParameter(runner.parameters[0], 'spawnCommand');

  const [guard, returnStatement] = runner.body.statements;
  if (
    !ts.isIfStatement(guard)
    || guard.elseStatement !== undefined
    || !ts.isBinaryExpression(guard.expression)
    || guard.expression.operatorToken.kind !== ts.SyntaxKind.ExclamationEqualsEqualsToken
    || !ts.isTypeOfExpression(guard.expression.left)
    || !isIdentifier(guard.expression.left.expression, 'spawnCommand')
    || !ts.isStringLiteral(guard.expression.right)
    || guard.expression.right.text !== 'function'
    || !isFailStatement(guard.thenStatement)
    || !ts.isReturnStatement(returnStatement)
    || !ts.isArrowFunction(returnStatement.expression)
  ) fail();
  const typeGuardReference = guard.expression.left.expression;
  const commandRunner = returnStatement.expression;
  if (
    !hasOnlyModifier(commandRunner, ts.SyntaxKind.AsyncKeyword)
    || commandRunner.typeParameters !== undefined
    || commandRunner.type !== undefined
    || commandRunner.parameters.length !== 3
  ) fail();
  const commandParameter = requireIdentifierParameter(commandRunner.parameters[0], 'command');
  const argsParameter = requireIdentifierParameter(commandRunner.parameters[1], 'args');
  requireIdentifierParameter(commandRunner.parameters[2], 'options', 'undefined');
  if (!ts.isBlock(commandRunner.body) || commandRunner.body.statements.length !== 1) fail();

  const tryStatement = commandRunner.body.statements[0];
  if (
    !ts.isTryStatement(tryStatement)
    || tryStatement.finallyBlock !== undefined
    || tryStatement.catchClause === undefined
    || tryStatement.catchClause.variableDeclaration !== undefined
    || tryStatement.catchClause.block.statements.length !== 1
    || !isFailStatement(tryStatement.catchClause.block.statements[0])
    || tryStatement.tryBlock.statements.length < 2
  ) fail();

  const commandGate = tryStatement.tryBlock.statements[0];
  if (
    !ts.isIfStatement(commandGate)
    || commandGate.elseStatement !== undefined
    || !ts.isBinaryExpression(commandGate.expression)
    || commandGate.expression.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken
    || !isStrictStringRejection(commandGate.expression.left, 'command', 'git')
    || !isStrictStringRejection(commandGate.expression.right, 'command', 'gh')
    || !isFailStatement(commandGate.thenStatement)
  ) fail();

  const spawnCalls = collectAstNodes(commandRunner, (node) => (
    ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && node.expression.questionDotToken === undefined
    && isIdentifier(node.expression.expression, 'Reflect')
    && isIdentifier(node.expression.name, 'apply')
    && node.arguments.length > 0
    && isIdentifier(node.arguments[0], 'spawnCommand')
  ));
  if (spawnCalls.length !== 1) fail();
  const spawnCall = spawnCalls[0];
  if (
    spawnCall.questionDotToken !== undefined
    || spawnCall.typeArguments !== undefined
    || spawnCall.arguments.length !== 3
    || !isIdentifier(spawnCall.arguments[1], 'undefined')
    || !ts.isArrayLiteralExpression(spawnCall.arguments[2])
    || spawnCall.arguments[2].elements.length !== 3
    || !isIdentifier(spawnCall.arguments[2].elements[0], 'command')
    || !isIdentifier(spawnCall.arguments[2].elements[1], 'safeArguments')
    || !isWithin(spawnCall, tryStatement.tryBlock)
    || commandGate.end > spawnCall.pos
  ) fail();
  verifySpawnOptions(spawnCall.arguments[2].elements[2]);

  const promiseConstructions = collectAstNodes(commandRunner, (node) => (
    ts.isNewExpression(node) && isIdentifier(node.expression, 'Promise')
  ));
  if (promiseConstructions.length !== 1) fail();
  const promiseConstruction = promiseConstructions[0];
  const promiseArguments = promiseConstruction.arguments;
  if (
    promiseConstruction.typeArguments !== undefined
    || promiseArguments === undefined
    || promiseArguments.length !== 1
    || !ts.isArrowFunction(promiseArguments[0])
    || checker.getSymbolAtLocation(promiseConstruction.expression) !== undefined
    || !ts.isAwaitExpression(promiseConstruction.parent)
    || promiseConstruction.parent.expression !== promiseConstruction
    || !ts.isReturnStatement(promiseConstruction.parent.parent)
    || promiseConstruction.parent.parent.expression !== promiseConstruction.parent
    || promiseConstruction.parent.parent.parent !== tryStatement.tryBlock
  ) fail();
  const promiseExecutor = promiseArguments[0];
  if (
    !hasNoModifiers(promiseExecutor)
    || promiseExecutor.typeParameters !== undefined
    || promiseExecutor.type !== undefined
    || promiseExecutor.parameters.length !== 2
    || !ts.isBlock(promiseExecutor.body)
    || !isWithin(spawnCall, promiseExecutor.body)
  ) fail();
  requireIdentifierParameter(promiseExecutor.parameters[0], 'resolve');
  requireIdentifierParameter(promiseExecutor.parameters[1], 'reject');

  const childDeclaration = spawnCall.parent;
  if (
    !ts.isVariableDeclaration(childDeclaration)
    || childDeclaration.initializer !== spawnCall
    || !isIdentifier(childDeclaration.name, 'child')
    || !ts.isVariableDeclarationList(childDeclaration.parent)
    || childDeclaration.parent.declarations.length !== 1
    || (childDeclaration.parent.flags & ts.NodeFlags.Const) === 0
    || !ts.isVariableStatement(childDeclaration.parent.parent)
    || childDeclaration.parent.parent.parent !== promiseExecutor.body
    || promiseExecutor.body.statements[0] !== childDeclaration.parent.parent
  ) fail();

  const safeArgumentDeclarations = collectAstNodes(tryStatement.tryBlock, (node) => (
    ts.isVariableDeclaration(node) && isIdentifier(node.name, 'safeArguments')
  ));
  if (safeArgumentDeclarations.length !== 1) fail();
  const safeArgumentDeclaration = safeArgumentDeclarations[0];
  if (
    safeArgumentDeclaration.type !== undefined
    || safeArgumentDeclaration.exclamationToken !== undefined
    || !ts.isCallExpression(safeArgumentDeclaration.initializer)
    || safeArgumentDeclaration.initializer.questionDotToken !== undefined
    || safeArgumentDeclaration.initializer.typeArguments !== undefined
    || !isIdentifier(safeArgumentDeclaration.initializer.expression, 'snapshotArguments')
    || safeArgumentDeclaration.initializer.arguments.length !== 1
    || !isIdentifier(safeArgumentDeclaration.initializer.arguments[0], 'args')
    || !ts.isVariableDeclarationList(safeArgumentDeclaration.parent)
    || safeArgumentDeclaration.parent.declarations.length !== 1
    || (safeArgumentDeclaration.parent.flags & ts.NodeFlags.Const) === 0
    || !ts.isVariableStatement(safeArgumentDeclaration.parent.parent)
    || safeArgumentDeclaration.parent.parent.parent !== tryStatement.tryBlock
    || safeArgumentDeclaration.parent.parent.pos < commandGate.end
    || safeArgumentDeclaration.parent.parent.end > spawnCall.pos
  ) fail();

  const firstGateCommand = commandGate.expression.left.left;
  const secondGateCommand = commandGate.expression.right.left;
  const spawnedCommand = spawnCall.arguments[2].elements[0];
  const spawnedArguments = spawnCall.arguments[2].elements[1];
  const snapshotReference = safeArgumentDeclaration.initializer.expression;
  const argsReference = safeArgumentDeclaration.initializer.arguments[0];
  requireExactIdentifierReferences(commandRunner, 'command', [
    commandParameter,
    firstGateCommand,
    secondGateCommand,
    spawnedCommand,
  ]);
  requireSameIdentifierBinding(checker, commandParameter, [
    firstGateCommand,
    secondGateCommand,
    spawnedCommand,
  ]);
  requireExactIdentifierReferences(commandRunner, 'args', [argsParameter, argsReference]);
  requireSameIdentifierBinding(checker, argsParameter, [argsReference]);
  requireExactIdentifierReferences(commandRunner, 'safeArguments', [
    safeArgumentDeclaration.name,
    spawnedArguments,
  ]);
  requireSameIdentifierBinding(checker, safeArgumentDeclaration.name, [spawnedArguments]);
  requireExactIdentifierReferences(commandRunner, 'snapshotArguments', [snapshotReference]);
  const snapshotFunction = findOnlyTopLevelFunction(sourceFile, 'snapshotArguments');
  requireExactIdentifierReferences(sourceFile, 'snapshotArguments', [
    snapshotFunction.name,
    snapshotReference,
  ]);
  requireSameIdentifierBinding(checker, snapshotFunction.name, [snapshotReference]);
  requireSameIdentifierBinding(checker, parameterReference, [
    typeGuardReference,
    spawnCall.arguments[0],
  ]);

  return Object.freeze({
    declarationName: runner.name,
    reflectReference: spawnCall.expression.expression,
    spawnCommandReferences: Object.freeze([
      parameterReference,
      typeGuardReference,
      spawnCall.arguments[0],
    ]),
  });
}

function verifyRunnerTestAdapter(sourceFile, checker) {
  const adapter = findOnlyTopLevelFunction(sourceFile, 'createBoundedCommandRunnerForTest');
  if (
    !hasOnlyModifier(adapter, ts.SyntaxKind.ExportKeyword)
    || adapter.asteriskToken !== undefined
    || adapter.typeParameters !== undefined
    || adapter.type !== undefined
    || adapter.parameters.length !== 1
    || adapter.body === undefined
    || adapter.body.statements.length !== 1
  ) fail();
  const parameterReference = requireIdentifierParameter(adapter.parameters[0], 'spawnCommand');
  const statement = adapter.body.statements[0];
  if (
    !ts.isReturnStatement(statement)
    || !ts.isCallExpression(statement.expression)
    || statement.expression.questionDotToken !== undefined
    || statement.expression.typeArguments !== undefined
    || !isIdentifier(statement.expression.expression, 'createBoundedCommandRunner')
    || statement.expression.arguments.length !== 1
    || !isIdentifier(statement.expression.arguments[0], 'spawnCommand')
  ) fail();
  requireSameIdentifierBinding(checker, parameterReference, [
    statement.expression.arguments[0],
  ]);
  return Object.freeze({
    spawnCommandReferences: Object.freeze([
      parameterReference,
      statement.expression.arguments[0],
    ]),
    runnerReference: statement.expression.expression,
  });
}

function verifyRunnerInitializer(sourceFile) {
  const statements = sourceFile.statements.filter((statement) => (
    ts.isVariableStatement(statement)
    && statement.declarationList.declarations.some((declaration) => (
      isIdentifier(declaration.name, 'BOUNDED_COMMAND_RUNNER')
    ))
  ));
  if (statements.length !== 1) fail();
  const statement = statements[0];
  if (
    !hasNoModifiers(statement)
    || statement.declarationList.declarations.length !== 1
    || (statement.declarationList.flags & ts.NodeFlags.Const) === 0
  ) fail();
  const declaration = statement.declarationList.declarations[0];
  if (
    !isIdentifier(declaration.name, 'BOUNDED_COMMAND_RUNNER')
    || declaration.type !== undefined
    || declaration.exclamationToken !== undefined
    || !ts.isCallExpression(declaration.initializer)
    || declaration.initializer.questionDotToken !== undefined
    || declaration.initializer.typeArguments !== undefined
    || !isIdentifier(declaration.initializer.expression, 'createBoundedCommandRunner')
    || declaration.initializer.arguments.length !== 1
    || !isIdentifier(declaration.initializer.arguments[0], 'spawn')
  ) fail();
  return Object.freeze({
    runnerReference: declaration.initializer.expression,
    spawnReference: declaration.initializer.arguments[0],
  });
}

function requireExactIdentifierReferences(sourceFile, name, expected) {
  const actual = collectAstNodes(sourceFile, (node) => isIdentifier(node, name));
  const allowed = new Set(expected);
  if (
    actual.length !== allowed.size
    || actual.some((node) => !allowed.has(node))
  ) fail();
}

function requireSameIdentifierBinding(checker, declaration, references) {
  const expected = checker.getSymbolAtLocation(declaration);
  if (
    expected === undefined
    || references.some((reference) => checker.getSymbolAtLocation(reference) !== expected)
  ) fail();
}

function verifyIntrinsicReflectReferences(sourceFile, checker, spawnReflectReference) {
  const references = collectAstNodes(sourceFile, (node) => isIdentifier(node, 'Reflect'));
  if (!references.includes(spawnReflectReference)) fail();
  for (const reference of references) {
    const propertyAccess = reference.parent;
    if (
      checker.getSymbolAtLocation(reference) !== undefined
      || !ts.isPropertyAccessExpression(propertyAccess)
      || propertyAccess.expression !== reference
      || propertyAccess.questionDotToken !== undefined
      || !isIdentifier(propertyAccess.name, 'apply')
        && !isIdentifier(propertyAccess.name, 'ownKeys')
      || !ts.isCallExpression(propertyAccess.parent)
      || propertyAccess.parent.expression !== propertyAccess
      || propertyAccess.parent.questionDotToken !== undefined
    ) fail();
  }
}

function verifyGitHubProcessAst(source) {
  const sourcePath = '/virtual/text-ai-preview-setup-github.mjs';
  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.JS,
  );
  if (sourceFile.parseDiagnostics.length !== 0) fail();
  const compilerOptions = Object.freeze({
    allowJs: true,
    checkJs: false,
    module: ts.ModuleKind.ESNext,
    noLib: true,
    noResolve: true,
    target: ts.ScriptTarget.ESNext,
  });
  const compilerHost = Object.freeze({
    fileExists: (file) => file === sourcePath,
    getCanonicalFileName: (file) => file,
    getCurrentDirectory: () => '/virtual',
    getDefaultLibFileName: () => '/virtual/lib.d.ts',
    getDirectories: () => [],
    getNewLine: () => '\n',
    getSourceFile: (file) => (file === sourcePath ? sourceFile : undefined),
    readFile: (file) => (file === sourcePath ? source : undefined),
    useCaseSensitiveFileNames: () => true,
    writeFile: () => fail(),
  });
  const program = ts.createProgram([sourcePath], compilerOptions, compilerHost);
  if (
    program.getSourceFile(sourcePath) !== sourceFile
    || program.getSyntacticDiagnostics(sourceFile).length !== 0
  ) fail();
  const checker = program.getTypeChecker();

  const childProcessImports = sourceFile.statements.filter((statement) => (
    ts.isImportDeclaration(statement)
    && ts.isStringLiteral(statement.moduleSpecifier)
    && statement.moduleSpecifier.text === 'node:child_process'
  ));
  if (childProcessImports.length !== 1) fail();
  const childProcessImport = childProcessImports[0];
  const childProcessLiterals = collectAstNodes(sourceFile, (node) => (
    ts.isStringLiteral(node) && node.text === 'node:child_process'
  ));
  const importClause = childProcessImport.importClause;
  if (
    childProcessLiterals.length !== 1
    || childProcessLiterals[0] !== childProcessImport.moduleSpecifier
    || childProcessImport.attributes !== undefined
    || !hasNoModifiers(childProcessImport)
    || importClause === undefined
    || importClause.isTypeOnly
    || importClause.name !== undefined
    || !ts.isNamedImports(importClause.namedBindings)
    || importClause.namedBindings.elements.length !== 1
  ) fail();
  const spawnImport = importClause.namedBindings.elements[0];
  if (
    spawnImport.isTypeOnly
    || spawnImport.propertyName !== undefined
    || !isIdentifier(spawnImport.name, 'spawn')
  ) fail();

  const allIdentifiers = collectAstNodes(sourceFile, (node) => ts.isIdentifier(node));
  if (allIdentifiers.some((node) => node.text === 'arguments')) fail();

  const runner = verifyBoundedRunnerFunction(sourceFile, checker);
  verifyIntrinsicReflectReferences(sourceFile, checker, runner.reflectReference);
  const testAdapter = verifyRunnerTestAdapter(sourceFile, checker);
  const initializer = verifyRunnerInitializer(sourceFile);
  requireExactIdentifierReferences(sourceFile, 'spawn', [
    spawnImport.name,
    initializer.spawnReference,
  ]);
  requireExactIdentifierReferences(sourceFile, 'spawnCommand', [
    ...runner.spawnCommandReferences,
    ...testAdapter.spawnCommandReferences,
  ]);
  requireExactIdentifierReferences(sourceFile, 'createBoundedCommandRunner', [
    runner.declarationName,
    testAdapter.runnerReference,
    initializer.runnerReference,
  ]);
  requireSameIdentifierBinding(checker, spawnImport.name, [initializer.spawnReference]);
  requireSameIdentifierBinding(checker, runner.declarationName, [
    testAdapter.runnerReference,
    initializer.runnerReference,
  ]);
}

function snapshotSources(value) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) fail();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail();
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== EXPECTED_FILES.length
      || keys.some((key) => typeof key !== 'string' || !EXPECTED_FILES.includes(key))
    ) fail();

    const result = new Map();
    let totalBytes = 0;
    for (const file of EXPECTED_FILES) {
      const descriptor = Object.getOwnPropertyDescriptor(value, file);
      if (
        descriptor === undefined
        || !Object.hasOwn(descriptor, 'value')
        || descriptor.enumerable !== true
        || typeof descriptor.value !== 'string'
      ) fail();
      const source = descriptor.value;
      const bytes = Buffer.byteLength(source, 'utf8');
      totalBytes += bytes;
      if (
        bytes < 1
        || bytes > MAX_SOURCE_BYTES
        || totalBytes > MAX_SOURCE_BYTES * EXPECTED_FILES.length
        || source.includes('\0')
        || source.includes('\r')
        || !source.endsWith('\n')
      ) fail();
      result.set(file, source);
    }
    return result;
  } catch {
    fail();
  }
}

function verifyDigests(sources) {
  for (const file of EXPECTED_FILES) {
    const digest = createHash('sha256').update(sources.get(file), 'utf8').digest('hex');
    if (digest !== EXPECTED_DIGESTS[file]) fail();
  }
}

function verifyNoForbiddenCapabilities(sources) {
  for (const file of EXPECTED_FILES) {
    const source = sources.get(file);
    if (
      FORBIDDEN.test(source)
      || EXTRA_EXECUTABLE_FAMILY.test(source)
      || FORBIDDEN_PROCESS_API.test(source)
      || FORBIDDEN_FILESYSTEM_API.test(source)
    ) fail();
    if (
      file !== 'scripts/text-ai-preview-setup-github.mjs'
      && source.includes("node:child_process")
    ) fail();
  }
}

function verifyPromptContract(sources) {
  const prompt = sources.get('scripts/text-ai-preview-setup-prompt.mjs');
  requireCount(prompt, PROMPT_LABEL_BLOCK);
  requireCount(prompt, FOUR_INPUT_BLOCK);
  requireCount(prompt, "    label: 'Continue? [y/N]',");
  requireCount(prompt, "    maxBytes: 1,");
  requireCount(prompt, "    return answer.toString('utf8') === 'y';");
  for (const label of ['Cloudflare API Token', 'ARK_API_KEY', 'user-1 email', 'user-2 email']) {
    requireCount(prompt, `'${label}'`, 2);
  }
  requireCount(prompt, "'Continue? [y/N]'", 2);
}

function verifyValueContract(sources) {
  const values = sources.get('scripts/text-ai-preview-setup-values.mjs');
  requireCount(values, SECRET_POLICY_BLOCK);
  requireCount(values, SECRET_WRITE_BLOCK);
  requireCount(values, "  variableNames: Object.freeze(['CLOUDFLARE_ACCOUNT_ID', 'TEXT_AI_TEAM_DOMAIN']),");
  requireCount(values, "    variables: Object.freeze([entry('TEXT_AI_TEAM_DOMAIN', teamDomain)]),");
  requireCount(values, "  serviceTokenName: 'tiezheng-text-ai-preview-github-actions',");
  requireCount(values, "  serviceTokenDuration: '8760h',");
}

function verifyCloudflareContract(sources) {
  const cloudflare = sources.get('scripts/text-ai-preview-setup-cloudflare.mjs');
  requireCount(cloudflare, `  const body = Object.freeze({
    name: SETUP_POLICY.serviceTokenName,
    duration: SETUP_POLICY.serviceTokenDuration,
    enabled: true,
  });`);
  requireCount(cloudflare, "    if (name === SETUP_POLICY.serviceTokenName) fail();");
  requireCount(cloudflare, "    && data.get('name') === SETUP_POLICY.serviceTokenName");
  requireCount(cloudflare, "    && data.get('duration') === SETUP_POLICY.serviceTokenDuration");
  requireCount(cloudflare, "    && (!data.has('enabled') || data.get('enabled') === true)");
}

function verifyGitHubContract(sources) {
  const github = sources.get('scripts/text-ai-preview-setup-github.mjs');
  verifyGitHubProcessAst(github);
  requireCount(github, '          else child.stdin.end(safeInput);');
  requireCount(github, "      await run('gh', args, { input: value });");
  requireCount(github, "    const args = ['secret', 'set', name, '--env', ENVIRONMENT, '--repo', REPO];");
  requireCount(github, "    const args = ['variable', 'set', name, '--env', ENVIRONMENT, '--repo', REPO];");
  requireCount(github, "const WRITABLE_VARIABLE_NAMES = Object.freeze(['TEXT_AI_TEAM_DOMAIN']);");
  requireCount(github, "const ACTIVE_STATUSES = Object.freeze(['queued', 'in_progress', 'waiting', 'pending', 'requested']);");
  requireCount(github, '      if (secretNames.size !== 0) fail();');
  requireCount(github, '      exactNames(variableNames, [ACCOUNT_VARIABLE]);');
  requireCount(github, "        '-f', 'operation=preflight',");
  requireCount(github, "        '-f', 'target=user-1',");
  requireCount(github, "        '-f', `expected_sha=${expectedSha}`,");
  requireCount(github, 'const REPORT_LINE = \'{"command":"preflight","status":"ready","workerTextEnabled":false}\';');
  requireCount(github, '    || report.workerTextEnabled !== false');
}

function verifyOrchestrationContract(sources) {
  const setup = sources.get('scripts/text-ai-preview-setup.mjs');
  for (const output of [
    "const FAILED_OUTPUT = 'SETUP FAILED\\n';",
    "const CANCELLED_OUTPUT = 'SETUP CANCELLED\\n';",
    "const PREFLIGHT_BLOCKED_OUTPUT = 'SETUP BLOCKED preflight\\n';",
    "const REPORT_BLOCKED_OUTPUT = 'SETUP BLOCKED output\\n';",
    SUCCESS_OUTPUT,
    "'SETUP BLOCKED cleanup=cloudflare.service-token\\n'",
    "`SETUP BLOCKED cleanup=${blocked.join(',')}\\n`",
  ]) requireCount(setup, output);
  requireCount(setup, "    secrets: snapshotWriteGroup(record.secrets, SETUP_POLICY.secretNames),");
  requireCount(setup, "    variables: snapshotWriteGroup(record.variables, ['TEXT_AI_TEAM_DOMAIN']),");
  requireCount(setup, '    await invoke(parsed.github.runDisabledPreflight, githubState.expectedSha);');
  requireCount(setup, '    for (const item of writePlan.secrets) {');
  requireCount(setup, '    for (const item of writePlan.variables) {');
  requireCount(setup, '    phase = \'complete\';');
}

function verifySemantics(value) {
  const sources = snapshotSources(value);
  verifyNoForbiddenCapabilities(sources);
  verifyPromptContract(sources);
  verifyValueContract(sources);
  verifyCloudflareContract(sources);
  verifyGitHubContract(sources);
  verifyOrchestrationContract(sources);
  return sources;
}

export function verifyTextPreviewSetupSemanticsForTest(value) {
  try {
    verifySemantics(value);
    return Object.freeze({ ...FIXED_REPORT });
  } catch {
    fail();
  }
}

export function verifyTextPreviewSetup(value) {
  try {
    const sources = verifySemantics(value);
    verifyDigests(sources);
    return Object.freeze({ ...FIXED_REPORT });
  } catch {
    fail();
  }
}

function sameStrings(actual, expected) {
  if (actual.length !== expected.length) fail();
  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index] !== expected[index]) fail();
  }
}

async function runCli(argv) {
  try {
    if (
      !Array.isArray(argv)
      || Object.getPrototypeOf(argv) !== Array.prototype
      || argv.length !== 0
    ) fail();

    const names = await readdir(resolve('scripts'), { encoding: 'utf8' });
    if (!Array.isArray(names) || names.some((name) => typeof name !== 'string')) fail();
    const discovered = names
      .filter((name) => (
        name.startsWith(SETUP_SOURCE_PREFIX) && !EXPECTED_TEST_NAMES.includes(name)
      ))
      .map((name) => `scripts/${name}`)
      .sort();
    sameStrings(discovered, [...EXPECTED_FILES].sort());

    const entries = await Promise.all(EXPECTED_FILES.map(async (file) => (
      [file, await readFile(resolve(file), 'utf8')]
    )));
    verifyTextPreviewSetup(Object.fromEntries(entries));
    process.stdout.write(`${FIXED_JSON}\n`);
    return 0;
  } catch {
    try {
      process.stderr.write(`${FAILURE_MESSAGE}\n`);
    } catch {
      // The fixed exit status is sufficient if the output channel itself fails.
    }
    return 1;
  }
}

function isDirectExecution() {
  try {
    return (
      typeof process.argv[1] === 'string'
      && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
    );
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  process.exitCode = await runCli(process.argv.slice(2));
}
