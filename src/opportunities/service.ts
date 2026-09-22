import { OpportunitiesRepository } from './repository';
import { CreateOpportunityInput, Opportunity } from './types';
import { ValidationError } from '../shared/errors';
import { ERROR_CODES } from '../shared/constants/error-codes';

const VALID_STATUSES: Opportunity['status'][] = ['open', 'won', 'lost', 'abandoned'];

export class OpportunitiesService {
  constructor(private readonly repository: OpportunitiesRepository) {}

  async createOpportunity(input: CreateOpportunityInput): Promise<Opportunity> {
    if (!input.name || !input.stageId || !input.owner) {
      throw new ValidationError(ERROR_CODES.OPPORTUNITY_FIELDS_REQUIRED);
    }

    const status = input.status ?? 'open';
    if (!VALID_STATUSES.includes(status)) {
      throw new ValidationError(ERROR_CODES.OPPORTUNITY_STATUS_INVALID);
    }
    return this.repository.createOpportunity({ ...input, status });
  }
}
