import { LassoContextProvider } from "./LassoContextProvider";

export function modifyConfig(config: Config): Config {
  if (!config.contextProviders) {
    config.contextProviders = [];
  }
  
  config.contextProviders.push( LassoContextProvider);

  return config;
}