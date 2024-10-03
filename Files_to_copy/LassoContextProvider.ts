import { LassoClient } from "./LassoClient";
import { callLLM, formulateLslScript, judgeRelevanceBatch } from "./LLMIntegration";

interface ContextProviderExtras {
  fullInput: string;
}

interface ContextItem {
  content: string;
  name: string;
  description: string;
}

const datasource = "mavenCentral2023";

function mapImplementationsToContextItems(implementations: any[]): ContextItem[] {
  return implementations.map((impl, index) => ({
    name: `Implementation ${index + 1}`,
    description: `Code snippet from system ${impl.id}`,
    content: impl.content || "No content available",
  }));
}

export const LassoContextProvider: CustomContextProvider = {
  title: "lasso",
  displayTitle: "LASSO",
  description: "Retrieve code snippets from LASSO code search engine",

  getContextItems: async (
    query: string,
    extras: ContextProviderExtras
  ): Promise<ContextItem[]> => {
    console.log("LASSO context provider called with query:", query);
    console.log("extras.fullInput:", extras.fullInput);

    var fullInput = extras.fullInput.replace("LASSO","")
    const maxRetries = 3;
    const lassoClient = new LassoClient();
    await lassoClient.authenticate();

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Generate LSL script arguments
        const lslScriptArgs = await callLLM( fullInput);
        console.log(`Attempt ${attempt}: LSL script arguments:`, lslScriptArgs);

        // Formulate LSL script
        const lslScript = formulateLslScript(lslScriptArgs);
        console.log(`Attempt ${attempt}: Executing LSL script:`, lslScript);

        // Execute LSL script with timeout
        const executionId = await lassoClient.executeLslScript(lslScript);
        console.log(`Attempt ${attempt}: LSL script execution started. Execution ID:`, executionId);

        await lassoClient.waitForExecution(executionId);
        console.log(`Attempt ${attempt}: LSL script execution completed`);


        // Retrieve and process results
        const reportResult = await lassoClient.executeLassoQuery(executionId);
        const topImplementations = lassoClient.getTopImplementations(reportResult, 5);

        if (topImplementations.length > 0) {
          const systemIds = topImplementations;
          const implementations = await lassoClient.getImplementations(datasource, systemIds);

          console.log(`Attempt ${attempt}: Top implementations:`, implementations);

          if (Array.isArray(implementations) && implementations.length > 0) {
            // Evaluate relevance for each implementation
            const judgments = await judgeRelevanceBatch(implementations.map(impl => ({ impl, content: impl.content })), fullInput);

            // Calculate total score and filter relevant implementations
            const relevantImplementations = judgments.map((judgment, index) => {
              const totalScore = Object.values(judgment.scores).reduce((sum, score) => sum + score, 0);
              console.log(totalScore)
              const isRelevant = totalScore >= 15; // Adjust the threshold as needed
              return { impl: implementations[index], isRelevant, totalScore };
            }).filter(({ isRelevant }) => isRelevant);

            console.log(`Attempt ${attempt}: Filtered implementations:`, relevantImplementations);

            if (relevantImplementations.length > 0) {
              return mapImplementationsToContextItems(relevantImplementations.map(({ impl }) => impl));
            }
          }
        }

        console.log(`Attempt ${attempt}: No valid implementations found, retrying...`);
      } catch (error) {
        console.error(`Attempt ${attempt} failed:`, error);
        console.error('Error details:', error.stack);
        if (attempt === maxRetries) throw error;
      }

      const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    throw new Error("Failed to find valid implementations after multiple attempts");
  },
};