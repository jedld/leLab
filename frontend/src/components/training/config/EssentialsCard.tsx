import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfigComponentProps } from '../types';

const EssentialsCard: React.FC<ConfigComponentProps> = ({ config, updateConfig }) => {
  return (
    <Card className="bg-slate-800/50 border-slate-700 rounded-xl">
      <CardHeader>
        <CardTitle className="text-white">Run Configuration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <Label htmlFor="dataset_repo_id" className="text-slate-300">
            Dataset Repository ID *
          </Label>
          <Input
            id="dataset_repo_id"
            value={config.dataset_repo_id}
            onChange={(e) => updateConfig('dataset_repo_id', e.target.value)}
            placeholder="e.g., your-username/your-dataset"
            className="bg-slate-900 border-slate-600 text-white rounded-lg"
          />
          <p className="text-xs text-slate-500 mt-1">
            HuggingFace Hub dataset repository ID
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="policy_type" className="text-slate-300">
              Policy
            </Label>
            <Select
              value={config.policy_type}
              onValueChange={(value) => updateConfig('policy_type', value)}
            >
              <SelectTrigger id="policy_type" className="bg-slate-900 border-slate-600 text-white rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-600">
                <SelectItem value="act">ACT (Action Chunking Transformer)</SelectItem>
                <SelectItem value="diffusion">Diffusion Policy</SelectItem>
                <SelectItem value="pi0">PI0</SelectItem>
                <SelectItem value="smolvla">SmolVLA</SelectItem>
                <SelectItem value="tdmpc">TD-MPC</SelectItem>
                <SelectItem value="vqbet">VQ-BeT</SelectItem>
                <SelectItem value="pi0fast">PI0 Fast</SelectItem>
                <SelectItem value="sac">SAC</SelectItem>
                <SelectItem value="reward_classifier">Reward Classifier</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="steps" className="text-slate-300">
              Training Steps
            </Label>
            <Input
              id="steps"
              type="number"
              value={config.steps}
              onChange={(e) => {
                const v = parseInt(e.target.value);
                if (!isNaN(v)) updateConfig('steps', v);
              }}
              className="bg-slate-900 border-slate-600 text-white rounded-lg"
            />
          </div>

          <div>
            <Label htmlFor="batch_size" className="text-slate-300">
              Batch Size
            </Label>
            <Input
              id="batch_size"
              type="number"
              value={config.batch_size}
              onChange={(e) => {
                const v = parseInt(e.target.value);
                if (!isNaN(v)) updateConfig('batch_size', v);
              }}
              className="bg-slate-900 border-slate-600 text-white rounded-lg"
            />
          </div>

          <div className="flex items-center space-x-3 pt-6">
            <Switch
              id="wandb_enable"
              checked={config.wandb_enable}
              onCheckedChange={(checked) => updateConfig('wandb_enable', checked)}
            />
            <Label htmlFor="wandb_enable" className="text-slate-300">
              Enable Weights & Biases
            </Label>
          </div>
        </div>

        {config.wandb_enable && (
          <div>
            <Label htmlFor="wandb_project" className="text-slate-300">
              W&B Project Name
            </Label>
            <Input
              id="wandb_project"
              value={config.wandb_project || ''}
              onChange={(e) =>
                updateConfig('wandb_project', e.target.value || undefined)
              }
              placeholder="my-robotics-project"
              className="bg-slate-900 border-slate-600 text-white rounded-lg"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default EssentialsCard;
