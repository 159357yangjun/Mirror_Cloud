import { mockRecipes } from '../../data/mock'
import { invoke, isTauriRuntime } from '../../platform/desktop/runtime'
import type { CreateCustomWorkflowInput, CreateWorkflowFromRecipeInput, RecipeView, WorkflowView } from '../../types'

export async function listRecipes(): Promise<RecipeView[]> {
  if (!isTauriRuntime()) return mockRecipes
  return invoke('list_recipes')
}

export async function listWorkflows(): Promise<WorkflowView[]> {
  if (!isTauriRuntime()) return []
  return invoke('list_workflows')
}

export async function createWorkflowFromRecipe(input: CreateWorkflowFromRecipeInput): Promise<WorkflowView> {
  return invoke('create_workflow_from_recipe', { input })
}

export async function createCustomWorkflow(input: CreateCustomWorkflowInput): Promise<WorkflowView> {
  return invoke('create_custom_workflow', { input })
}

export async function setDefaultWorkflow(workflowId: string): Promise<void> {
  return invoke('set_default_workflow', { workflowId })
}

export async function deleteWorkflow(workflowId: string): Promise<void> {
  return invoke('delete_workflow', { workflowId })
}
