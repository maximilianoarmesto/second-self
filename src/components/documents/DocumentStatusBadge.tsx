import React from 'react';
import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { DocumentStatus } from '@/types/document';

interface DocumentStatusBadgeProps {
  status: DocumentStatus | string;
}

const STATUS_CONFIG: Record<
  string,
  {
    label: string;
    variant: 'default' | 'outline' | 'destructive';
    icon: React.ReactNode;
  }
> = {
  COMPLETED: {
    label: 'Completed',
    variant: 'default',
    icon: <CheckCircle2 className="w-3 h-3" />,
  },
  completed: {
    label: 'Completed',
    variant: 'default',
    icon: <CheckCircle2 className="w-3 h-3" />,
  },
  PROCESSING: {
    label: 'Processing',
    variant: 'outline',
    icon: <Loader2 className="w-3 h-3 animate-spin" />,
  },
  processing: {
    label: 'Processing',
    variant: 'outline',
    icon: <Loader2 className="w-3 h-3 animate-spin" />,
  },
  PENDING: {
    label: 'Pending',
    variant: 'outline',
    icon: <Clock className="w-3 h-3" />,
  },
  pending: {
    label: 'Pending',
    variant: 'outline',
    icon: <Clock className="w-3 h-3" />,
  },
  FAILED: {
    label: 'Failed',
    variant: 'destructive',
    icon: <XCircle className="w-3 h-3" />,
  },
  failed: {
    label: 'Failed',
    variant: 'destructive',
    icon: <XCircle className="w-3 h-3" />,
  },
};

const DEFAULT_CONFIG = {
  label: 'Unknown',
  variant: 'outline' as const,
  icon: <Clock className="w-3 h-3" />,
};

export function DocumentStatusBadge({ status }: DocumentStatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? DEFAULT_CONFIG;
  return (
    <Badge variant={config.variant}>
      {config.icon}
      {config.label}
    </Badge>
  );
}
