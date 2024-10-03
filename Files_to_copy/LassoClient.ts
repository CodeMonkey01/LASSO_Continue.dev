import axios from 'axios';

// LASSO API configuration
const BASE_URL = "http://localhost:10222";  // Replace with your LASSO API base URL
const AUTH_ENDPOINT = `${BASE_URL}/auth/signin`;
const EXECUTE_ENDPOINT = `${BASE_URL}/api/v1/lasso/execute`;
const STATUS_ENDPOINT = `${BASE_URL}/api/v1/lasso/scripts/{executionId}/status`;
const REPORT_ENDPOINT = `${BASE_URL}/api/v1/lasso/report/{executionId}`;
const FILE_ENDPOINT = `${BASE_URL}/api/v1/lasso/scripts/{executionId}/records/file`;

// Authentication credentials
const username = "admin";
const password = "admin";

export class LassoClient {
  private token: string;

  constructor() {
    this.token = "";
  }

  async authenticate() {
    try {
      const response = await axios.post(AUTH_ENDPOINT, { username, password });
      if (response.status === 200) {
        this.token = response.data.token;
      } else {
        throw new Error("Authentication failed");
      }
    } catch (error) {
      throw new Error("Authentication failed: " + error.message);
    }
  }

  async executeLslScript(script: string) {
    const headers = { Authorization: `Bearer ${this.token}` };
    try {
      const response = await axios.post(EXECUTE_ENDPOINT, { script }, { headers });
      if (response.status === 200) {
        return response.data.executionId;
      } else {
        throw new Error("Script execution failed");
      }
    } catch (error) {
      throw new Error("Script execution failed: " + error.message);
    }
  }

  async waitForExecution(executionId: string) {
    const headers = { Authorization: `Bearer ${this.token}` };
    while (true) {
      try {
        const response = await axios.get(STATUS_ENDPOINT.replace('{executionId}', executionId), { headers });
        if (response.status === 200) {
          const status = response.data.status;
          if (status === "SUCCESSFUL") {
            return;
          } else if (status === "FAILED") {
            throw new Error("Execution failed");
          }
        }
      } catch (error) {
        throw new Error("Execution failed: " + error.message);
      }
      await new Promise(resolve => setTimeout(resolve, 5000));  // Wait for 5 seconds before checking again
    }
  }

  async getExecutionResult(executionId: string) {
    const headers = { Authorization: `Bearer ${this.token}` };
    try {
      const response = await axios.get(REPORT_ENDPOINT.replace('{executionId}', executionId), { headers });
      if (response.status === 200) {
        return response.data;
      } else {
        throw new Error("Failed to retrieve execution result");
      }
    } catch (error) {
      throw new Error("Failed to retrieve execution result: " + error.message);
    }
  }

  async getImplementations(dataSource: string, systemIds: string[]) {
    const queryUrl = `${BASE_URL}/api/v1/lasso/datasource/${dataSource}/implementations`;
    const headers = {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json'
    };
    console.log(systemIds)
    const payload = {
      ids: systemIds
    };
    try {
      const response = await axios.post(queryUrl, payload, { headers });
      if (response.status === 200) {
        const implementationsObject = response.data.implementations;
        const implementationsArray = Object.values(implementationsObject);
        return implementationsArray;
      } else {
        throw new Error("Failed to retrieve implementations");
      }
    } catch (error) {
      throw new Error("Failed to retrieve implementations: " + error.message);
    }
  }

  getTopImplementations(reportResult: any, limit: number): string[] {
    console.log(reportResult);
    console.log(reportResult["SELECTREPORT"]);
    console.log(reportResult["RANKREPORT"]);
  
    const rankReport = reportResult["RANKREPORT"];
    const selectReport = reportResult["SELECTREPORT"];
  
    if (rankReport && rankReport.length > 0) {
      // Handle the case for RankReport
      const sortedImplementations = rankReport.sort((a: any, b: any) => a.RANKPOSITION - b.RANKPOSITION);
      console.log("sorted imp:", sortedImplementations)
      return sortedImplementations.slice(0, limit).map((record: any) => record.SYSTEM);

    } else if (selectReport && selectReport.length > 0) {

      // Extract system IDs from the SELECTREPORT array
      const systemIds = selectReport.slice(0, limit).map((record: any) => record.SYSTEM);
      return systemIds;

    } else {

      // Handle the case when both RANKREPORT and SELECTREPORT are not available or an error occurs
      console.error("Failed to retrieve implementations");
      return [];
    }
  }
  
  async executeLassoQuery(executionId: string) {
    const reportUrl = `${BASE_URL}/api/v1/lasso/report/${executionId}`;
    const headers = {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json'
    };

    // First, get the list of available reports
    try {
      const response = await axios.get(reportUrl, { headers });
      const availableReports = response.data;
      console.log("Available reports:", availableReports);

      const allReportData: { [key: string]: any } = {};

      // Query each available report
      for (const report of availableReports) {
        const data = {
          sql: `SELECT * from ${report}`
        };

        const reportResponse = await axios.post(reportUrl, data, { headers });

        if (reportResponse.status === 200) {
          const reportData = reportResponse.data;
          allReportData[report] = reportData;
          console.log(`Successfully retrieved data from ${report}`);
        } else {
          console.log(`Failed to retrieve data from ${report}. Status code: ${reportResponse.status}`);
        }
      }

      return allReportData;
    } catch (error) {
      throw new Error("Failed to retrieve available reports: " + error.message);
    }
  }
}