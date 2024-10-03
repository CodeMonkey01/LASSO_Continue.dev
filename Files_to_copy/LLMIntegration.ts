import { Ollama } from 'ollama';

interface LslScriptArgs {
  interfaceSpec: string;
  totalRows: number;
  noOfAdapters: number;
  tests: string[];
  studyName: string;
  abstractionName: string;
  abstractionVariableName: string;
}

// Ollama API endpoint
const ollamaApiEndpoint = 'http://localhost:11434';
const scriptModel = 'qwen2.5-coder:7b-instruct-q8_0';
const judgeModel = 'qwen2.5-coder:7b-instruct-q8_0';
const datasource = 'mavenCentral2023';

const ollama = new Ollama({
  host: ollamaApiEndpoint,
});

export async function processUserQuery(query: string, lastComponents?: LslScriptArgs): Promise<string> {
  const previousInstructions = lastComponents
    ? `
- Last generation failed. Please generate a different interface name that describes the method.
- Last interface spec: "${lastComponents.interfaceSpec}"
- Last abstraction name: "${lastComponents.abstractionName}"
- Last abstraction variable name: "${lastComponents.abstractionVariableName}"
    `
    : '';

  const prompt = `
Task: Generate LSL script components based on a user query.

Instructions:
${previousInstructions}
- LASSO retrieves Java snippets and requires an LSL script.
- Based on the user query, generate the following components:

1. **interfaceSpec**: Method interface in LQL notation.
   - Format: """<interface_spec>"""
   - Simplify object inputs by inferring appropriate data types based on context.
   - Example: """PalindromeGenerator{generatePalindrome(int)->int}"""

2. **studyName**: A meaningful name for the study.
   - Example: Derived from interfaceSpec, such as "CalculatePrice Study"

3. **abstractionName**: A meaningful abstraction name.
   - Example: Derived from studyName, such as "CalculatePrice"

4. **abstractionVariableName**: A meaningful abstraction variable name.
   - Convert abstractionName to a variable-friendly format.
   - Example: "calculatePrice"

5. **testSequences**: Comprehensive test sequences to filter candidates.
   - **IMPORTANT**: Generate the output in the exact format below. Do not use JSON.

\`\`\`
interfaceSpec: """<interface_spec>"""
studyName: <study_name>
abstractionName: <abstraction_name>
abstractionVariableName: <abstraction_variable_name>
testSequences:
'test_name_1': sheet(<parameters>) {
    row <output>, '<method_name>', <input1>, <input2>
    row <output>, '<method_name>', <input1>, <input2>
},
'test_name_2': sheet(<parameters>) {
    row <output>, '<method_name>', <input1>, <input2>
    row <output>, '<method_name>', <input1>, <input2>
}
\`\`\`

Additional Instructions:
- Ensure the interface is correctly formatted, e.g., """PalindromeGenerator{generatePalindrome(int)->int}"""
- In case inputs or outputs are objects, guess the most likely basic data type instead.
- Use context to predict method functionalities and appropriate online method names.
- Do not use the '%' sign in test sequences.
- If tests are provided, incorporate them directly into the testSequences section, do not generate extra tests unless explicitly asked to do so.
- Exclude any explanations or additional text.

Generate the LSL script components for the following query:

**User Query:** ${query}

**Examples:**

\`\`\`
interfaceSpec: """Base64{encode(byte[])->byte[]}"""
studyName: Base64encode
abstractionName: Base64
abstractionVariableName: base64encode
testSequences:
'testEncode': sheet(base64:'Base64', p2:"user:pass".getBytes()) {
    row '', 'create', '?base64'
    row 'dXNlcjpwYXNz'.getBytes(), 'encode', 'A1', '?p2'
},
'testEncode_padding': sheet(base64:'Base64', p2:"Hello World".getBytes()) {
    row '', 'create', '?base64'
    row 'SGVsbG8gV29ybGQ='.getBytes(), 'encode', 'A1', '?p2'
}
\`\`\`

\`\`\`
interfaceSpec: """PalindromeGenerator{generatePalindrome(int)->int}"""
studyName: PalindromeNumberGenerator
abstractionName: PalindromeGenerator
abstractionVariableName: palindromeNumberGenerator
testSequences:
'testGeneratePalindrome': sheet(generator:'PalindromeGenerator', input:123) {
    row '', 'create', '?generator'
    row 12321, 'generatePalindrome', 'A1', '?input'
},
'testGeneratePalindromeWithSingleDigit': sheet(generator:'PalindromeGenerator', input:5) {
    row '', 'create', '?generator'
    row 55, 'generatePalindrome', 'A1', '?input'
},
'testGeneratePalindromeWithZero': sheet(generator:'PalindromeGenerator', input:0) {
    row '', 'create', '?generator'
    row 0, 'generatePalindrome', 'A1', '?input'
}
\`\`\`
  `;

  return prompt;
}

export async function callLLM(query: string, lastGeneratedComponents?: LslScriptArgs): Promise<LslScriptArgs> {
  const maxRetries = 3;
  let lastComponents: LslScriptArgs | null = lastGeneratedComponents || null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      let prompt = await processUserQuery(query, lastComponents);

      if (lastComponents) {
        prompt += "\n- Please use different abstraction details than: " + JSON.stringify(lastComponents);
      }

      console.log("Reaching inside LLM.");
      console.log("Prompt:",prompt);
      const result = await ollama.generate({
        prompt: prompt,
        model: scriptModel,
        keep_alive: 60000, // Keep the model loaded for 60 seconds
        options: {
          num_ctx: 12000
        }
      });

      console.log("Raw inner LLM response:", scriptModel, result);

      if (result && result.response) {
        const lslScriptArgs = extractLslScriptArgs(result.response);
        if (isValidLslScriptArgs(lslScriptArgs)) {
          lastComponents = lslScriptArgs;
          return lslScriptArgs;
        }
      }

      console.log(`Attempt ${attempt}: Invalid or incomplete LSL script arguments, retrying...`);
    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error);
      if (attempt === maxRetries) throw error;
    }
  }

  throw new Error("Failed to generate valid LSL script arguments after multiple attempts");
}

export async function judgeRelevanceBatch(implementations: { impl: any; content: string }[], query: string): Promise<{ scores: Record<string, number>; justification: string }[]> {
  console.log("reached judge LLM batch", query);
  const judgments: { scores: Record<string, number>; justification: string }[] = [];

  for (const impl of implementations) {
    const prompt = `
      Given the following query and output, evaluate the relevance and quality of the RAG based on these criteria:

      1. Functionality: Does the output implement the required functionality?, judge in terms of overall usefulness, even if partly unfunctional (1-5)
      2. Readability: Is the code readable and maintainable? (1-5)
      3. Best Practices: Does the output adhere to common coding standards and best practices? (1-5)
      4. Performance: Is the code efficient and optimized for performance? (1-5)
      5. Robustness: Does the code handle edge cases and potential errors gracefully? (1-5)

      Provide a score for each criterion (1-5) and a brief justification for your scores. Do not output Asterisks at all, no * or **.

      Query: ${query}

      Output: ${impl.content}

      Example format:
      Functionality: 5
      Justification: The code clearly implements the required functionality.
      Readability: 4
      Justification: The code is mostly readable but lacks some comments.
      Best Practices: 4
      Justification: The code follows common practices but could be improved with better naming conventions.
      Performance: 3
      Justification: The code is efficient but could be optimized further.
      Robustness: 3
      Justification: The code handles basic edge cases but lacks extensive error handling.
    `;

    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await ollama.generate({
          prompt: prompt,
          model: judgeModel,
          keep_alive: 60000, // Keep the model loaded for 60 seconds
          "options": {
            "num_ctx": 12000
          }
        });

        console.log(`Attempt ${attempt}: Raw judge LLM response:`, result);

        if (result && result.response) {
          const cleanedResponse = result.response.trim();
          const scores: Record<string, number> = {};
          let justification = '';

          // Unified regex to extract scores and justifications
          const unifiedRegex = /(?<criterion>\w+(?:\s+\w+)*):\s*(?<score>\d+(?:\/\d+)?)\s*(?:Justification:)?\s*(?<justification>[\s\S]*?)(?=\n\w+:|$)/g;
          let match;
          while ((match = unifiedRegex.exec(cleanedResponse)) !== null) {
            const criterion = match.groups?.criterion.trim();
            const score = match.groups?.score.trim();
            const justificationText = match.groups?.justification.trim();

            if (criterion && score) {
              const scoreValue = parseInt(score.split('/')[0]); // Handle scores like x/y
              scores[criterion] = scoreValue;
            }

            if (justificationText) {
              justification += justificationText + ' ';
            }
          }

          justification = justification.trim();

          if (Object.keys(scores).length >= 3) {
            judgments.push({ scores, justification });
            break;
          }
        }

        console.log(`Attempt ${attempt}: Invalid judge response, retrying...`);
      } catch (error) {
        console.error(`Attempt ${attempt} failed:`, error);
        if (attempt === maxRetries) {
          // Assign default scores and justification if all attempts fail
          const defaultScores = {
            Functionality: 3,
            Readability: 3,
            'Best Practices': 3,
            Performance: 3,
            Robustness: 3
          };
          const defaultJustification = "Failed to get a valid judgment after multiple attempts.";
          judgments.push({ scores: defaultScores, justification: defaultJustification });
        }
      }
    }
  }

  return judgments;
}

function extractLslScriptArgs(text: string): Partial<LslScriptArgs> {
  const result: Partial<LslScriptArgs> = {
    totalRows: 10,
    noOfAdapters: 50,
    tests: []
  };

  // Remove code block markers and try parsing as JSON
  const cleanedText = text.replace(/```json\n|\n```/g, '');

  try {
    const jsonOutput = JSON.parse(cleanedText);
    result.interfaceSpec = jsonOutput.interfaceSpec;
    result.studyName = jsonOutput.studyName;
    result.abstractionName = jsonOutput.abstractionName;
    result.abstractionVariableName = jsonOutput.abstractionVariableName;
    result.tests = jsonOutput.testSequences.map((sequence: any) => {
      const testName = Object.keys(sequence)[0];
      const testBody = sequence[testName];
      return `'${testName}': ${JSON.stringify(testBody)}`;
    });
  } catch (error) {
    // Fallback to regular expression extraction
    const interfaceSpecMatch = cleanedText.match(/interfaceSpec:\s*"""(.+?)"""/s);
    if (interfaceSpecMatch) result.interfaceSpec = interfaceSpecMatch[1].trim();

    const studyNameMatch = cleanedText.match(/studyName:\s*(.+)/);
    if (studyNameMatch) result.studyName = studyNameMatch[1].trim();

    const abstractionNameMatch = cleanedText.match(/abstractionName:\s*(.+)/);
    if (abstractionNameMatch) result.abstractionName = abstractionNameMatch[1].trim();

    const abstractionVariableNameMatch = cleanedText.match(/abstractionVariableName:\s*(.+)/);
    if (abstractionVariableNameMatch) result.abstractionVariableName = abstractionVariableNameMatch[1].trim();

    const testSequencesMatch = cleanedText.match(/testSequences:\s*([\s\S]+?)(?=\n\w+:|\s*$)/);
    if (testSequencesMatch) {
      result.tests = testSequencesMatch[1].split('\n').map(line => line.trim()).filter(line => line);
    }
  }

  return result;
}

function isValidLslScriptArgs(args: Partial<LslScriptArgs>): args is LslScriptArgs {
  return !!(args.interfaceSpec && args.studyName && args.abstractionName && args.tests && args.tests.length > 0 && args.abstractionVariableName);
}

export function formulateLslScript(args: LslScriptArgs): string {
  if (!isValidLslScriptArgs(args)) {
    throw new Error("Invalid LSL script arguments");
  }
  const { interfaceSpec, totalRows, noOfAdapters, tests, studyName, abstractionName, abstractionVariableName } = args;
    
  const datasource = generateDatasource();
  const selectAction = generateSelectAction(studyName, abstractionName, interfaceSpec, totalRows);
  const filterAction = generateFilterAction(studyName, abstractionName, interfaceSpec, noOfAdapters, tests);

  return `
    ${datasource}
    def totalRows = ${totalRows}
    def noOfAdapters = ${noOfAdapters}
    def interfaceSpec = """${interfaceSpec}"""
    study(name: '${studyName}') {
      ${selectAction}
      ${filterAction}
      action(name: 'rank', type: 'Rank') {
        criteria = ['FunctionalSimilarityReport.score:MAX:1']
        dependsOn 'filter'
        includeAbstractions '*'
      }
      action(name: "clones", type: 'Nicad6') {
        cloneType = "type2" // clone type to reject
        collapseClones = true // remove clone implementations
        dependsOn "select"
        includeAbstractions '${abstractionName}'
        profile {
          environment('nicad') {
            image = 'nicad:6.2'
          }
        }
      }
    }
  `;
}

function generateFilterAction(studyName: string, abstractionName: string, interfaceSpec: string, noOfAdapters: number, testSequences: string[]): string {
  const sequences = testSequences.map(test => test.trim()).join('\n        ');
  return `
    action(name: 'filter', type: 'ArenaExecute') {
      containerTimeout = 10 * 60 * 1000L
      specification = interfaceSpec
      sequences = [
        ${sequences}
      ]
      features = ['cc']
      maxAdaptations = ${noOfAdapters}
      dependsOn 'select'
      includeAbstractions '${abstractionName}'
      profile('myTdsProfile') {
        scope('class') { type = 'class' }
        environment('java17') {
          image = 'maven:3.6.3-openjdk-17'
        }
      }
      whenAbstractionsReady() {
        def ${abstractionName.toLowerCase()} = abstractions['${abstractionName}']
        def expectedBehaviour = toOracle(srm(abstraction: ${abstractionName.toLowerCase()}).sequences)
        def matchesSrm = srm(abstraction: ${abstractionName.toLowerCase()})
                .systems
                .equalTo(expectedBehaviour)
      }
    }
  `;
}

function generateDatasource(): string {
  return "dataSource '"+datasource+"'";
}

function generateSelectAction(studyName: string, abstractionName: string, interfaceSpec: string, totalRows: number): string {
  return `
    action(name: 'select', type: 'Select') {
      abstraction('${abstractionName}') {
        queryForClasses interfaceSpec, 'class-simple'
        rows = ${totalRows}
        excludeClassesByKeywords(['private', 'abstract'])
        excludeTestClasses()
        excludeInternalPkgs()
      }
    }
  `;
}