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
  'scripts/text-ai-preview-setup-cloudflare.mjs': '6fc7fdc1dadda9fa66434b49b7e395e1c8003902df2310df410e6d0cf36f4ab8',
  'scripts/text-ai-preview-setup-github.mjs': 'b4cf8a4d824e3ec2d016996c4f101c8ecefd873681181c3fd12c2e14c642ba8f',
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

function findOnlyFunction(sourceFile, name) {
  const matches = collectAstNodes(sourceFile, (node) => (
    ts.isFunctionDeclaration(node) && isIdentifier(node.name, name)
  ));
  if (matches.length !== 1) fail();
  return matches[0];
}

function findOnlyTopLevelConst(sourceFile, name) {
  const matches = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (isIdentifier(declaration.name, name)) matches.push({ statement, declaration });
    }
  }
  if (matches.length !== 1) fail();
  const { statement, declaration } = matches[0];
  if (
    !hasNoModifiers(statement)
    || statement.declarationList.declarations.length !== 1
    || (statement.declarationList.flags & ts.NodeFlags.Const) === 0
    || declaration.type !== undefined
    || declaration.exclamationToken !== undefined
    || declaration.initializer === undefined
  ) fail();
  return declaration;
}

function unwrapParentheses(node) {
  let value = node;
  while (ts.isParenthesizedExpression(value)) value = value.expression;
  return value;
}

function compactNodeText(node, sourceFile) {
  return node.getText(sourceFile).replace(/\s+/gu, ' ').trim();
}

function createCheckedJavaScriptProgram(sourcePath, source) {
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
  return Object.freeze({ sourceFile, checker: program.getTypeChecker() });
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

function propertyAccessPath(node) {
  const parts = [];
  let current = node;
  while (ts.isPropertyAccessExpression(current)) {
    if (!ts.isIdentifier(current.name) || current.questionDotToken !== undefined) return null;
    parts.unshift(current.name.text);
    current = current.expression;
  }
  if (!ts.isIdentifier(current)) return null;
  parts.unshift(current.text);
  return parts;
}

function requirePropertyAccessPath(node, expected) {
  const actual = propertyAccessPath(node);
  if (actual === null || actual.length !== expected.length) fail();
  for (let index = 0; index < expected.length; index += 1) {
    if (actual[index] !== expected[index]) fail();
  }
}

function verifyCapturedMapWrapper(sourceFile, checker, functionName, methodName, parameters) {
  const declaration = findOnlyTopLevelFunction(sourceFile, functionName);
  if (
    !hasNoModifiers(declaration)
    || declaration.asteriskToken !== undefined
    || declaration.typeParameters !== undefined
    || declaration.type !== undefined
    || declaration.parameters.length !== parameters.length
    || declaration.body === undefined
    || declaration.body.statements.length !== 1
  ) fail();
  const parameterDeclarations = declaration.parameters.map((parameter, index) => (
    requireIdentifierParameter(parameter, parameters[index])
  ));
  const statement = declaration.body.statements[0];
  if (
    !ts.isReturnStatement(statement)
    || !ts.isCallExpression(statement.expression)
    || statement.expression.questionDotToken !== undefined
    || statement.expression.typeArguments !== undefined
    || !isIdentifier(statement.expression.expression, 'REFLECT_APPLY')
    || statement.expression.arguments.length !== 3
    || !isIdentifier(statement.expression.arguments[0], methodName)
    || !isIdentifier(statement.expression.arguments[1], parameters[0])
    || !ts.isArrayLiteralExpression(statement.expression.arguments[2])
    || statement.expression.arguments[2].elements.length !== parameters.length - 1
  ) fail();
  const argumentReferences = statement.expression.arguments[2].elements;
  for (let index = 1; index < parameters.length; index += 1) {
    if (!isIdentifier(argumentReferences[index - 1], parameters[index])) fail();
  }

  const reflectApply = findOnlyTopLevelConst(sourceFile, 'REFLECT_APPLY');
  const method = findOnlyTopLevelConst(sourceFile, methodName);
  requirePropertyAccessPath(reflectApply.initializer, ['Reflect', 'apply']);
  requirePropertyAccessPath(method.initializer, ['Map', 'prototype', methodName.slice(4).toLowerCase()]);
  if (
    checker.getSymbolAtLocation(reflectApply.initializer.expression) !== undefined
    || checker.getSymbolAtLocation(method.initializer.expression.expression) !== undefined
  ) fail();
  requireSameIdentifierBinding(checker, reflectApply.name, [statement.expression.expression]);
  requireSameIdentifierBinding(checker, method.name, [statement.expression.arguments[0]]);
  requireSameIdentifierBinding(checker, parameterDeclarations[0], [statement.expression.arguments[1]]);
  for (let index = 1; index < parameterDeclarations.length; index += 1) {
    requireSameIdentifierBinding(checker, parameterDeclarations[index], [argumentReferences[index - 1]]);
  }
  return method.initializer;
}

function verifyCloudflareResponseAst(source) {
  const { sourceFile, checker } = createCheckedJavaScriptProgram(
    '/virtual/text-ai-preview-setup-cloudflare.mjs',
    source,
  );

  const utilImports = sourceFile.statements.filter((statement) => (
    ts.isImportDeclaration(statement)
    && ts.isStringLiteral(statement.moduleSpecifier)
    && statement.moduleSpecifier.text === 'node:util'
  ));
  if (utilImports.length !== 1) fail();
  const utilImport = utilImports[0];
  const utilImportClause = utilImport.importClause;
  if (
    utilImport.attributes !== undefined
    || !hasNoModifiers(utilImport)
    || utilImportClause === undefined
    || utilImportClause.isTypeOnly
    || utilImportClause.name !== undefined
    || !ts.isNamedImports(utilImportClause.namedBindings)
    || utilImportClause.namedBindings.elements.length !== 1
  ) fail();
  const utilTypesImport = utilImportClause.namedBindings.elements[0];
  if (
    utilTypesImport.isTypeOnly
    || !isIdentifier(utilTypesImport.propertyName, 'types')
    || !isIdentifier(utilTypesImport.name, 'NODE_UTIL_TYPES')
  ) fail();
  const isProxyConstant = findOnlyTopLevelConst(sourceFile, 'IS_PROXY');
  if (
    !ts.isPropertyAccessExpression(isProxyConstant.initializer)
    || !isIdentifier(isProxyConstant.initializer.expression, 'NODE_UTIL_TYPES')
    || !isIdentifier(isProxyConstant.initializer.name, 'isProxy')
  ) fail();
  requireSameIdentifierBinding(checker, utilTypesImport.name, [
    isProxyConstant.initializer.expression,
  ]);

  const mapGetInitializer = verifyCapturedMapWrapper(
    sourceFile,
    checker,
    'mapGet',
    'MAP_GET',
    ['value', 'key'],
  );
  const mapHasInitializer = verifyCapturedMapWrapper(
    sourceFile,
    checker,
    'mapHas',
    'MAP_HAS',
    ['value', 'key'],
  );
  const mapSetInitializer = verifyCapturedMapWrapper(
    sourceFile,
    checker,
    'mapSet',
    'MAP_SET',
    ['value', 'key', 'item'],
  );
  const setHas = findOnlyTopLevelConst(sourceFile, 'SET_HAS');
  const setSizeGet = findOnlyTopLevelConst(sourceFile, 'SET_SIZE_GET');
  requirePropertyAccessPath(setHas.initializer, ['Set', 'prototype', 'has']);
  if (
    !ts.isPropertyAccessExpression(setSizeGet.initializer)
    || !isIdentifier(setSizeGet.initializer.name, 'get')
    || !ts.isCallExpression(setSizeGet.initializer.expression)
    || propertyAccessPath(setSizeGet.initializer.expression.expression)?.join('.') !== 'Object.getOwnPropertyDescriptor'
  ) fail();
  const dynamicMapLookups = collectAstNodes(sourceFile, (node) => (
    ts.isPropertyAccessExpression(node)
    && ['get', 'has', 'set'].includes(node.name.text)
  ));
  const allowedPrototypeLookups = new Set([
    mapGetInitializer,
    mapHasInitializer,
    mapSetInitializer,
    setHas.initializer,
    setSizeGet.initializer,
  ]);
  if (
    dynamicMapLookups.length !== allowedPrototypeLookups.size
    || dynamicMapLookups.some((node) => !allowedPrototypeLookups.has(node))
  ) fail();

  const responseValidator = findOnlyTopLevelFunction(sourceFile, 'responseIsValid');
  if (
    responseValidator.parameters.length !== 1
    || responseValidator.body === undefined
    || responseValidator.body.statements.length !== 2
  ) fail();
  const parsedParameter = requireIdentifierParameter(responseValidator.parameters[0], 'parsed');
  const dataDeclarations = collectAstNodes(responseValidator, (node) => (
    ts.isBindingElement(node) && isIdentifier(node.name, 'data')
  ));
  const returnStatements = responseValidator.body.statements.filter(ts.isReturnStatement);
  if (dataDeclarations.length !== 1 || returnStatements.length !== 1) fail();
  const dataDeclaration = dataDeclarations[0];
  if (
    dataDeclaration.dotDotDotToken !== undefined
    || dataDeclaration.propertyName !== undefined
    || dataDeclaration.initializer !== undefined
    || !ts.isObjectBindingPattern(dataDeclaration.parent)
    || dataDeclaration.parent.elements.length !== 1
    || !ts.isVariableDeclaration(dataDeclaration.parent.parent)
    || !isIdentifier(dataDeclaration.parent.parent.initializer, 'parsed')
  ) fail();
  requireSameIdentifierBinding(checker, parsedParameter, [dataDeclaration.parent.parent.initializer]);

  const returnExpression = returnStatements[0].expression;
  if (returnExpression === undefined) fail();
  const enabledPredicates = collectAstNodes(returnExpression, (node) => (
    ts.isBinaryExpression(node)
    && node.operatorToken.kind === ts.SyntaxKind.BarBarToken
  ));
  if (enabledPredicates.length !== 1) fail();
  const enabledPredicate = enabledPredicates[0];
  const missingEnabled = unwrapParentheses(enabledPredicate.left);
  const strictTrue = unwrapParentheses(enabledPredicate.right);
  if (
    !ts.isPrefixUnaryExpression(missingEnabled)
    || missingEnabled.operator !== ts.SyntaxKind.ExclamationToken
    || !ts.isCallExpression(missingEnabled.operand)
    || missingEnabled.operand.arguments.length !== 2
    || !isIdentifier(missingEnabled.operand.expression, 'mapHas')
    || !isIdentifier(missingEnabled.operand.arguments[0], 'data')
    || !ts.isStringLiteral(missingEnabled.operand.arguments[1])
    || missingEnabled.operand.arguments[1].text !== 'enabled'
    || !ts.isBinaryExpression(strictTrue)
    || strictTrue.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken
    || !ts.isCallExpression(strictTrue.left)
    || strictTrue.left.arguments.length !== 2
    || !isIdentifier(strictTrue.left.expression, 'mapGet')
    || !isIdentifier(strictTrue.left.arguments[0], 'data')
    || !ts.isStringLiteral(strictTrue.left.arguments[1])
    || strictTrue.left.arguments[1].text !== 'enabled'
    || strictTrue.right.kind !== ts.SyntaxKind.TrueKeyword
  ) fail();
  const mapHas = findOnlyTopLevelFunction(sourceFile, 'mapHas');
  const mapGet = findOnlyTopLevelFunction(sourceFile, 'mapGet');
  requireSameIdentifierBinding(checker, mapHas.name, [missingEnabled.operand.expression]);
  requireSameIdentifierBinding(checker, mapGet.name, [strictTrue.left.expression]);
  requireSameIdentifierBinding(checker, dataDeclaration.name, [
    missingEnabled.operand.arguments[0],
    strictTrue.left.arguments[0],
  ]);

  const creator = findOnlyTopLevelFunction(sourceFile, 'createSetupServiceToken');
  if (creator.parameters.length !== 1 || creator.body === undefined) fail();
  const clientParameter = requireIdentifierParameter(creator.parameters[0], 'client');
  const parsedDeclarations = collectAstNodes(creator, (node) => (
    ts.isVariableDeclaration(node) && isIdentifier(node.name, 'parsed')
  ));
  const responseDeclarations = collectAstNodes(creator, (node) => (
    ts.isVariableDeclaration(node) && isIdentifier(node.name, 'response')
  ));
  const validatorCalls = collectAstNodes(creator, (node) => (
    ts.isCallExpression(node) && isIdentifier(node.expression, 'responseIsValid')
  ));
  if (
    parsedDeclarations.length !== 1
    || responseDeclarations.length !== 1
    || validatorCalls.length !== 1
  ) fail();
  const parsedDeclaration = parsedDeclarations[0];
  const responseDeclaration = responseDeclarations[0];
  const validatorCall = validatorCalls[0];
  if (
    !ts.isCallExpression(parsedDeclaration.initializer)
    || !isIdentifier(parsedDeclaration.initializer.expression, 'readResponseRecord')
    || parsedDeclaration.initializer.arguments.length !== 1
    || !isIdentifier(parsedDeclaration.initializer.arguments[0], 'response')
    || validatorCall.arguments.length !== 1
    || !isIdentifier(validatorCall.arguments[0], 'parsed')
    || !ts.isIfStatement(validatorCall.parent)
    || validatorCall.parent.expression !== validatorCall
    || !ts.isVariableDeclarationList(parsedDeclaration.parent)
    || !ts.isVariableStatement(parsedDeclaration.parent.parent)
    || parsedDeclaration.parent.parent.parent !== creator.body
    || validatorCall.parent.parent !== creator.body
    || creator.body.statements.indexOf(parsedDeclaration.parent.parent)
      >= creator.body.statements.indexOf(validatorCall.parent)
  ) fail();
  const responseReaderDeclaration = findOnlyTopLevelFunction(sourceFile, 'readResponseRecord');
  requireExactIdentifierReferences(sourceFile, 'responseIsValid', [
    responseValidator.name,
    validatorCall.expression,
  ]);
  requireSameIdentifierBinding(checker, responseValidator.name, [validatorCall.expression]);
  requireSameIdentifierBinding(checker, responseReaderDeclaration.name, [
    parsedDeclaration.initializer.expression,
  ]);
  requireSameIdentifierBinding(checker, responseDeclaration.name, [
    parsedDeclaration.initializer.arguments[0],
  ]);
  requireSameIdentifierBinding(checker, parsedDeclaration.name, [validatorCall.arguments[0]]);

  const creatorStatements = creator.body.statements;
  const responseStatement = responseDeclaration.parent.parent;
  const parsedStatement = parsedDeclaration.parent.parent;
  const responseTry = creatorStatements[2];
  const successIf = validatorCall.parent;
  const deleteIf = creatorStatements[5];
  const finalReturn = creatorStatements[6];
  if (
    creatorStatements.length !== 7
    || creatorStatements[1] !== responseStatement
    || creatorStatements[3] !== parsedStatement
    || creatorStatements[4] !== successIf
    || !ts.isTryStatement(responseTry)
    || responseTry.finallyBlock !== undefined
    || responseTry.catchClause === undefined
    || responseTry.catchClause.variableDeclaration !== undefined
    || responseTry.catchClause.block.statements.length !== 1
    || !ts.isBlock(successIf.thenStatement)
    || successIf.thenStatement.statements.length !== 1
    || successIf.elseStatement !== undefined
    || !ts.isIfStatement(deleteIf)
    || compactNodeText(deleteIf, sourceFile) !== 'if (parsed.id !== undefined) return deleteCompensation(client, parsed.id);'
    || !ts.isReturnStatement(finalReturn)
    || compactNodeText(finalReturn, sourceFile) !== 'return inventoryCompensation(client);'
  ) fail();
  const catchReturn = responseTry.catchClause.block.statements[0];
  const successReturn = successIf.thenStatement.statements[0];
  const deleteReturn = deleteIf.thenStatement;
  if (
    !ts.isReturnStatement(catchReturn)
    || compactNodeText(catchReturn, sourceFile) !== 'return inventoryCompensation(client);'
    || !ts.isReturnStatement(successReturn)
    || !ts.isReturnStatement(deleteReturn)
  ) fail();
  const creatorReturns = collectAstNodes(creator.body, (node) => ts.isReturnStatement(node));
  const allowedReturns = new Set([catchReturn, successReturn, deleteReturn, finalReturn]);
  if (
    creatorReturns.length !== allowedReturns.size
    || creatorReturns.some((node) => !allowedReturns.has(node))
  ) fail();

  const credentialFreeze = successReturn.expression;
  if (
    !ts.isCallExpression(credentialFreeze)
    || credentialFreeze.questionDotToken !== undefined
    || credentialFreeze.typeArguments !== undefined
    || propertyAccessPath(credentialFreeze.expression)?.join('.') !== 'Object.freeze'
    || checker.getSymbolAtLocation(credentialFreeze.expression.expression) !== undefined
    || credentialFreeze.arguments.length !== 1
    || !ts.isObjectLiteralExpression(credentialFreeze.arguments[0])
  ) fail();
  const credentialProperties = credentialFreeze.arguments[0].properties;
  const expectedCredentials = [
    ['id', 'id'],
    ['clientId', 'client_id'],
    ['clientSecret', 'client_secret'],
  ];
  if (credentialProperties.length !== expectedCredentials.length) fail();
  const credentialMapGetReferences = [];
  const credentialParsedReferences = [];
  for (let index = 0; index < expectedCredentials.length; index += 1) {
    const property = credentialProperties[index];
    const [propertyName, responseKey] = expectedCredentials[index];
    if (
      !ts.isPropertyAssignment(property)
      || !isIdentifier(property.name, propertyName)
      || !ts.isCallExpression(property.initializer)
      || property.initializer.questionDotToken !== undefined
      || property.initializer.typeArguments !== undefined
      || !isIdentifier(property.initializer.expression, 'mapGet')
      || property.initializer.arguments.length !== 2
      || !ts.isPropertyAccessExpression(property.initializer.arguments[0])
      || !isIdentifier(property.initializer.arguments[0].expression, 'parsed')
      || !isIdentifier(property.initializer.arguments[0].name, 'data')
      || !ts.isStringLiteral(property.initializer.arguments[1])
      || property.initializer.arguments[1].text !== responseKey
    ) fail();
    credentialMapGetReferences.push(property.initializer.expression);
    credentialParsedReferences.push(property.initializer.arguments[0].expression);
  }
  requireSameIdentifierBinding(checker, mapGet.name, credentialMapGetReferences);
  requireSameIdentifierBinding(checker, parsedDeclaration.name, credentialParsedReferences);

  const catchInventoryCall = catchReturn.expression;
  const deleteCompensationCall = deleteReturn.expression;
  const finalInventoryCall = finalReturn.expression;
  if (
    !ts.isCallExpression(catchInventoryCall)
    || !isIdentifier(catchInventoryCall.expression, 'inventoryCompensation')
    || catchInventoryCall.arguments.length !== 1
    || !isIdentifier(catchInventoryCall.arguments[0], 'client')
    || !ts.isCallExpression(deleteCompensationCall)
    || !isIdentifier(deleteCompensationCall.expression, 'deleteCompensation')
    || deleteCompensationCall.arguments.length !== 2
    || !isIdentifier(deleteCompensationCall.arguments[0], 'client')
    || !ts.isPropertyAccessExpression(deleteCompensationCall.arguments[1])
    || !isIdentifier(deleteCompensationCall.arguments[1].expression, 'parsed')
    || !isIdentifier(deleteCompensationCall.arguments[1].name, 'id')
    || !ts.isCallExpression(finalInventoryCall)
    || !isIdentifier(finalInventoryCall.expression, 'inventoryCompensation')
    || finalInventoryCall.arguments.length !== 1
    || !isIdentifier(finalInventoryCall.arguments[0], 'client')
  ) fail();
  const inventoryCompensation = findOnlyTopLevelFunction(sourceFile, 'inventoryCompensation');
  const deleteCompensation = findOnlyTopLevelFunction(sourceFile, 'deleteCompensation');
  requireSameIdentifierBinding(checker, inventoryCompensation.name, [
    catchInventoryCall.expression,
    finalInventoryCall.expression,
  ]);
  requireSameIdentifierBinding(checker, deleteCompensation.name, [
    deleteCompensationCall.expression,
  ]);
  requireSameIdentifierBinding(checker, clientParameter, [
    catchInventoryCall.arguments[0],
    deleteCompensationCall.arguments[0],
    finalInventoryCall.arguments[0],
  ]);
  requireSameIdentifierBinding(checker, parsedDeclaration.name, [
    deleteCompensationCall.arguments[1].expression,
  ]);

  const responseReader = responseReaderDeclaration;
  if (responseReader.parameters.length !== 1 || responseReader.body === undefined) fail();
  const valueParameter = requireIdentifierParameter(responseReader.parameters[0], 'value');
  const proxyGuards = collectAstNodes(responseReader, (node) => (
    ts.isIfStatement(node)
    && ts.isCallExpression(node.expression)
    && isIdentifier(node.expression.expression, 'REFLECT_APPLY')
    && node.expression.arguments.length === 3
    && isIdentifier(node.expression.arguments[0], 'IS_PROXY')
  ));
  if (proxyGuards.length !== 1) fail();
  const proxyGuard = proxyGuards[0];
  const proxyCall = proxyGuard.expression;
  const readerTry = responseReader.body.statements[1];
  if (
    !ts.isTryStatement(readerTry)
    || readerTry.tryBlock.statements[1] !== proxyGuard
    || proxyGuard.elseStatement !== undefined
    || compactNodeText(proxyGuard.thenStatement, sourceFile) !== 'state.malformed = true;'
    || proxyCall.questionDotToken !== undefined
    || proxyCall.typeArguments !== undefined
    || !isIdentifier(proxyCall.arguments[1], 'undefined')
    || !ts.isArrayLiteralExpression(proxyCall.arguments[2])
    || proxyCall.arguments[2].elements.length !== 1
    || !isIdentifier(proxyCall.arguments[2].elements[0], 'value')
  ) fail();
  const reflectApplyConstant = findOnlyTopLevelConst(sourceFile, 'REFLECT_APPLY');
  requireExactIdentifierReferences(sourceFile, 'NODE_UTIL_TYPES', [
    utilTypesImport.name,
    isProxyConstant.initializer.expression,
  ]);
  requireExactIdentifierReferences(sourceFile, 'IS_PROXY', [
    isProxyConstant.name,
    proxyCall.arguments[0],
  ]);
  requireSameIdentifierBinding(checker, isProxyConstant.name, [proxyCall.arguments[0]]);
  requireSameIdentifierBinding(checker, reflectApplyConstant.name, [proxyCall.expression]);
  requireSameIdentifierBinding(checker, valueParameter, [proxyCall.arguments[2].elements[0]]);
  const enabledDescriptorDeclarations = collectAstNodes(responseReader, (node) => (
    ts.isVariableDeclaration(node) && isIdentifier(node.name, 'enabledDescriptor')
  ));
  if (enabledDescriptorDeclarations.length !== 1) fail();
  const enabledDescriptor = enabledDescriptorDeclarations[0];
  if (enabledDescriptor.initializer !== undefined) fail();
  const descriptorAssignments = collectAstNodes(responseReader, (node) => (
    ts.isBinaryExpression(node)
    && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && isIdentifier(node.left, 'enabledDescriptor')
    && ts.isCallExpression(node.right)
    && propertyAccessPath(node.right.expression)?.join('.') === 'Object.getOwnPropertyDescriptor'
  ));
  if (descriptorAssignments.length !== 1) fail();
  const descriptorAssignment = descriptorAssignments[0];
  const descriptorCall = descriptorAssignment.right;
  if (
    descriptorCall.arguments.length !== 2
    || !isIdentifier(descriptorCall.arguments[0], 'value')
    || !ts.isStringLiteral(descriptorCall.arguments[1])
    || descriptorCall.arguments[1].text !== 'enabled'
    || checker.getSymbolAtLocation(descriptorCall.expression.expression) !== undefined
  ) fail();
  requireSameIdentifierBinding(checker, enabledDescriptor.name, [descriptorAssignment.left]);
  requireSameIdentifierBinding(checker, valueParameter, [descriptorCall.arguments[0]]);

  const ownKeysConstant = findOnlyTopLevelConst(sourceFile, 'REFLECT_OWN_KEYS');
  requirePropertyAccessPath(ownKeysConstant.initializer, ['Reflect', 'ownKeys']);
  const ownKeyCalls = collectAstNodes(responseReader, (node) => (
    ts.isCallExpression(node)
    && isIdentifier(node.expression, 'REFLECT_OWN_KEYS')
    && node.arguments.length === 1
    && isIdentifier(node.arguments[0], 'value')
  ));
  if (ownKeyCalls.length !== 1 || descriptorAssignment.end >= ownKeyCalls[0].pos) fail();
  requireSameIdentifierBinding(checker, ownKeysConstant.name, [ownKeyCalls[0].expression]);
  requireSameIdentifierBinding(checker, valueParameter, [ownKeyCalls[0].arguments[0]]);

  const presenceGuards = collectAstNodes(responseReader, (node) => (
    ts.isIfStatement(node)
    && compactNodeText(node, sourceFile) === 'if (!sawIdKey || sawEnabledKey !== (enabledDescriptor !== undefined)) state.malformed = true;'
  ));
  if (presenceGuards.length !== 1) fail();
  const sawEnabledDeclarations = collectAstNodes(responseReader, (node) => (
    ts.isVariableDeclaration(node) && isIdentifier(node.name, 'sawEnabledKey')
  ));
  if (sawEnabledDeclarations.length !== 1) fail();
  const guardIdentifiers = collectAstNodes(presenceGuards[0].expression, (node) => ts.isIdentifier(node));
  const enabledDescriptorReferences = guardIdentifiers.filter((node) => node.text === 'enabledDescriptor');
  const sawEnabledReferences = guardIdentifiers.filter((node) => node.text === 'sawEnabledKey');
  if (enabledDescriptorReferences.length !== 1 || sawEnabledReferences.length !== 1) fail();
  requireSameIdentifierBinding(checker, enabledDescriptor.name, enabledDescriptorReferences);
  requireSameIdentifierBinding(checker, sawEnabledDeclarations[0].name, sawEnabledReferences);
}

function verifyGitHubActiveStatusesAst(sourceFile, checker) {
  const activeStatuses = findOnlyTopLevelConst(sourceFile, 'ACTIVE_STATUSES');
  const initializer = activeStatuses.initializer;
  if (
    !ts.isCallExpression(initializer)
    || initializer.questionDotToken !== undefined
    || initializer.typeArguments !== undefined
    || propertyAccessPath(initializer.expression)?.join('.') !== 'Object.freeze'
    || initializer.arguments.length !== 1
    || !ts.isArrayLiteralExpression(initializer.arguments[0])
    || checker.getSymbolAtLocation(initializer.expression.expression) !== undefined
  ) fail();
  const expectedStatuses = ['queued', 'in_progress', 'waiting', 'pending', 'requested'];
  const elements = initializer.arguments[0].elements;
  if (elements.length !== expectedStatuses.length) fail();
  for (let index = 0; index < expectedStatuses.length; index += 1) {
    if (!ts.isStringLiteral(elements[index]) || elements[index].text !== expectedStatuses[index]) fail();
  }

  const validator = findOnlyTopLevelFunction(sourceFile, 'statusIsCompleted');
  if (
    validator.parameters.length !== 1
    || validator.body === undefined
    || validator.body.statements.length !== 3
  ) fail();
  const valueParameter = requireIdentifierParameter(validator.parameters[0], 'value');
  const loop = validator.body.statements[1];
  const finalReturn = validator.body.statements[2];
  if (
    !ts.isForOfStatement(loop)
    || loop.awaitModifier !== undefined
    || loop.initializer.declarations.length !== 1
    || (loop.initializer.flags & ts.NodeFlags.Const) === 0
    || !isIdentifier(loop.initializer.declarations[0].name, 'activeStatus')
    || !isIdentifier(loop.expression, 'ACTIVE_STATUSES')
    || compactNodeText(loop.statement, sourceFile) !== '{ if (value === activeStatus) return false; }'
    || !ts.isReturnStatement(finalReturn)
    || finalReturn.expression === undefined
    || compactNodeText(finalReturn.expression, sourceFile) !== "value === 'completed'"
  ) fail();
  const activeStatusDeclaration = loop.initializer.declarations[0];
  const loopIdentifiers = collectAstNodes(loop.statement, (node) => ts.isIdentifier(node));
  const valueReferences = loopIdentifiers.filter((node) => node.text === 'value');
  const activeStatusReferences = loopIdentifiers.filter((node) => node.text === 'activeStatus');
  const finalValueReferences = collectAstNodes(finalReturn.expression, (node) => isIdentifier(node, 'value'));
  if (
    valueReferences.length !== 1
    || activeStatusReferences.length !== 1
    || finalValueReferences.length !== 1
  ) fail();
  requireExactIdentifierReferences(sourceFile, 'ACTIVE_STATUSES', [
    activeStatuses.name,
    loop.expression,
  ]);
  requireSameIdentifierBinding(checker, activeStatuses.name, [loop.expression]);
  requireSameIdentifierBinding(checker, valueParameter, [...valueReferences, ...finalValueReferences]);
  requireSameIdentifierBinding(checker, activeStatusDeclaration.name, activeStatusReferences);
}

function verifyStableRunInventoryParserAst(sourceFile, checker) {
  const validator = findOnlyTopLevelFunction(sourceFile, 'validateStableRunInventory');
  if (
    validator.parameters.length !== 1
    || validator.body === undefined
    || validator.body.statements.length !== 5
  ) fail();
  const valueParameter = requireIdentifierParameter(validator.parameters[0], 'value');
  const [parsedStatement, limitGuard, arrayKeysStatement, denseGuard, loop] = validator.body.statements;
  if (
    compactNodeText(parsedStatement, sourceFile) !== 'const parsed = parseJson(value);'
    || compactNodeText(limitGuard, sourceFile) !== 'if (!Array.isArray(parsed) || parsed.length >= 100) fail();'
    || compactNodeText(arrayKeysStatement, sourceFile) !== 'const arrayKeys = Reflect.ownKeys(parsed);'
    || compactNodeText(denseGuard, sourceFile) !== 'if (arrayKeys.length !== parsed.length + 1) fail();'
    || !ts.isForStatement(loop)
    || compactNodeText(loop.initializer, sourceFile) !== 'let index = 0'
    || compactNodeText(loop.condition, sourceFile) !== 'index < parsed.length'
    || compactNodeText(loop.incrementor, sourceFile) !== 'index += 1'
    || !ts.isBlock(loop.statement)
  ) fail();
  const expectedLoopStatements = [
    'if (!Object.hasOwn(parsed, String(index))) fail();',
    'const record = plainRecord(parsed[index]);',
    'const keys = Reflect.ownKeys(record);',
    "if ( keys.length !== 2 || keys.some((key) => typeof key !== 'string') || !Object.hasOwn(record, 'databaseId') || !Object.hasOwn(record, 'status') ) fail();",
    "const databaseId = dataProperty(record, 'databaseId');",
    "const status = dataProperty(record, 'status');",
    'if (!Number.isSafeInteger(databaseId) || databaseId <= 0 || !statusIsCompleted(status)) fail();',
  ];
  const actualLoopStatements = loop.statement.statements.map((statement) => (
    compactNodeText(statement, sourceFile)
  ));
  if (actualLoopStatements.length !== expectedLoopStatements.length) fail();
  for (let index = 0; index < expectedLoopStatements.length; index += 1) {
    if (actualLoopStatements[index] !== expectedLoopStatements[index]) fail();
  }

  if (!ts.isVariableStatement(parsedStatement)) fail();
  const parsedDeclaration = parsedStatement.declarationList.declarations[0];
  if (
    parsedStatement.declarationList.declarations.length !== 1
    || !isIdentifier(parsedDeclaration.name, 'parsed')
    || !ts.isCallExpression(parsedDeclaration.initializer)
    || !isIdentifier(parsedDeclaration.initializer.expression, 'parseJson')
    || parsedDeclaration.initializer.arguments.length !== 1
    || !isIdentifier(parsedDeclaration.initializer.arguments[0], 'value')
  ) fail();
  const parseJson = findOnlyTopLevelFunction(sourceFile, 'parseJson');
  requireSameIdentifierBinding(checker, parseJson.name, [parsedDeclaration.initializer.expression]);
  requireSameIdentifierBinding(checker, valueParameter, [parsedDeclaration.initializer.arguments[0]]);

  const statusCalls = collectAstNodes(loop.statement, (node) => (
    ts.isCallExpression(node)
    && isIdentifier(node.expression, 'statusIsCompleted')
  ));
  if (statusCalls.length !== 1 || statusCalls[0].arguments.length !== 1) fail();
  const statusValidator = findOnlyTopLevelFunction(sourceFile, 'statusIsCompleted');
  requireSameIdentifierBinding(checker, statusValidator.name, [statusCalls[0].expression]);
  return validator;
}

function containingStatement(node) {
  let current = node;
  while (current.parent !== undefined && !ts.isBlock(current.parent)) current = current.parent;
  if (current.parent === undefined || !ts.isBlock(current.parent)) fail();
  return Object.freeze({ statement: current, block: current.parent });
}

function verifyGitHubStableSnapshotAst(sourceFile, checker) {
  const inventoryValidator = verifyStableRunInventoryParserAst(sourceFile, checker);
  const clientFactory = findOnlyTopLevelFunction(sourceFile, 'createGitHubSetupClient');
  if (clientFactory.body === undefined) fail();
  const runDeclarations = collectAstNodes(clientFactory.body, (node) => (
    ts.isVariableDeclaration(node) && isIdentifier(node.name, 'run')
  ));
  if (runDeclarations.length !== 1) fail();
  const runDeclaration = runDeclarations[0];
  const runSymbol = checker.getSymbolAtLocation(runDeclaration.name);
  if (runSymbol === undefined) fail();

  const preflight = findOnlyFunction(sourceFile, 'runDisabledPreflight');
  if (
    preflight.body === undefined
    || preflight.parent !== clientFactory.body
    || !hasOnlyModifier(preflight, ts.SyntaxKind.AsyncKeyword)
  ) fail();
  const boundRunCalls = collectAstNodes(sourceFile, (node) => (
    ts.isCallExpression(node)
    && isIdentifier(node.expression, 'run')
    && checker.getSymbolAtLocation(node.expression) === runSymbol
  ));
  const inventoryCalls = boundRunCalls.filter((call) => (
    call.arguments.length === 2
    && ts.isStringLiteral(call.arguments[0])
    && call.arguments[0].text === 'gh'
    && ts.isArrayLiteralExpression(call.arguments[1])
    && call.arguments[1].elements.length >= 2
    && ts.isStringLiteral(call.arguments[1].elements[0])
    && call.arguments[1].elements[0].text === 'run'
    && ts.isStringLiteral(call.arguments[1].elements[1])
    && call.arguments[1].elements[1].text === 'list'
  ));
  if (inventoryCalls.length !== 1) fail();
  const inventoryCall = inventoryCalls[0];
  if (!isWithin(inventoryCall, preflight)) fail();
  const inventoryArguments = inventoryCall.arguments[1].elements;
  const expectedArguments = [
    'run',
    'list',
    '--workflow',
    null,
    '--event',
    'workflow_dispatch',
    '--limit',
    '100',
    '--json',
    'databaseId,status',
    '--repo',
    null,
  ];
  if (inventoryArguments.length !== expectedArguments.length) fail();
  for (let index = 0; index < expectedArguments.length; index += 1) {
    const expected = expectedArguments[index];
    if (expected === null) continue;
    if (!ts.isStringLiteral(inventoryArguments[index]) || inventoryArguments[index].text !== expected) fail();
  }
  if (!isIdentifier(inventoryArguments[3], 'WORKFLOW') || !isIdentifier(inventoryArguments[11], 'REPO')) fail();
  const workflow = findOnlyTopLevelConst(sourceFile, 'WORKFLOW');
  const repo = findOnlyTopLevelConst(sourceFile, 'REPO');
  requireSameIdentifierBinding(checker, workflow.name, [inventoryArguments[3]]);
  requireSameIdentifierBinding(checker, repo.name, [inventoryArguments[11]]);

  const awaitedInventory = inventoryCall.parent;
  const parserCall = awaitedInventory.parent;
  if (
    !ts.isAwaitExpression(awaitedInventory)
    || awaitedInventory.expression !== inventoryCall
    || !ts.isCallExpression(parserCall)
    || !isIdentifier(parserCall.expression, 'validateStableRunInventory')
    || parserCall.arguments.length !== 1
    || parserCall.arguments[0] !== awaitedInventory
    || !ts.isExpressionStatement(parserCall.parent)
  ) fail();
  requireExactIdentifierReferences(sourceFile, 'validateStableRunInventory', [
    inventoryValidator.name,
    parserCall.expression,
  ]);
  requireSameIdentifierBinding(checker, inventoryValidator.name, [parserCall.expression]);

  const dispatchCalls = boundRunCalls.filter((call) => (
    call.arguments.length >= 2
    && ts.isStringLiteral(call.arguments[0])
    && call.arguments[0].text === 'gh'
    && ts.isArrayLiteralExpression(call.arguments[1])
    && call.arguments[1].elements.length >= 2
    && ts.isStringLiteral(call.arguments[1].elements[0])
    && call.arguments[1].elements[0].text === 'workflow'
    && ts.isStringLiteral(call.arguments[1].elements[1])
    && call.arguments[1].elements[1].text === 'run'
  ));
  if (dispatchCalls.length !== 1 || !isWithin(dispatchCalls[0], preflight)) fail();
  const inventoryLocation = containingStatement(parserCall);
  const dispatchLocation = containingStatement(dispatchCalls[0]);
  if (
    inventoryLocation.block !== dispatchLocation.block
    || !isWithin(inventoryLocation.block, preflight)
    || inventoryLocation.block.statements.indexOf(inventoryLocation.statement) === -1
    || inventoryLocation.block.statements.indexOf(dispatchLocation.statement) === -1
    || inventoryLocation.block.statements.indexOf(inventoryLocation.statement)
      >= inventoryLocation.block.statements.indexOf(dispatchLocation.statement)
  ) fail();
}

function verifyGitHubProcessAst(source) {
  const { sourceFile, checker } = createCheckedJavaScriptProgram(
    '/virtual/text-ai-preview-setup-github.mjs',
    source,
  );

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
  verifyGitHubActiveStatusesAst(sourceFile, checker);
  verifyGitHubStableSnapshotAst(sourceFile, checker);
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
  verifyCloudflareResponseAst(cloudflare);
  requireCount(cloudflare, `  const body = Object.freeze({
    name: SETUP_POLICY.serviceTokenName,
    duration: SETUP_POLICY.serviceTokenDuration,
    enabled: true,
  });`);
  requireCount(cloudflare, "    if (name === SETUP_POLICY.serviceTokenName) fail();");
  requireCount(cloudflare, "    && mapGet(data, 'name') === SETUP_POLICY.serviceTokenName");
  requireCount(cloudflare, "    && mapGet(data, 'duration') === SETUP_POLICY.serviceTokenDuration");
}

function verifyGitHubContract(sources) {
  const github = sources.get('scripts/text-ai-preview-setup-github.mjs');
  verifyGitHubProcessAst(github);
  requireCount(github, '          else child.stdin.end(safeInput);');
  requireCount(github, "      await run('gh', args, { input: value });");
  requireCount(github, "    const args = ['secret', 'set', name, '--env', ENVIRONMENT, '--repo', REPO];");
  requireCount(github, "    const args = ['variable', 'set', name, '--env', ENVIRONMENT, '--repo', REPO];");
  requireCount(github, "const WRITABLE_VARIABLE_NAMES = Object.freeze(['TEXT_AI_TEAM_DOMAIN']);");
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
