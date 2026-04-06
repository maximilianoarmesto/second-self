import React from 'react';
import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { DocumentStatus } from '@/types/document';

interface DocumentStatusBadgeProps {
  status: DocumentStatus;
}

const STATUS_CONFIG: Record<
  DocumentStatus,
  {
    label: string;
    variant: 'success' | 'warning' | 'destructive' | 'secondary';
    icon: React.ReactNode;
  }
> = {
  completed: {
    label: 'Completed',
    variant: 'success',
    icon: <CheckCircle2 className="w-3 h-3" />,
  },
  processing: {
    label: 'Processing',
    variant: 'warning',
    icon: <Loader2 className="w-3 h-3 animate-spin" />,
  },
  pending: {
    label: 'Pending',
    variant: 'secondary',
    icon: <Clock className="w-3 h-3" />,
  },
  failed: {
    label: 'Failed',
    variant: 'destructive',
    icon: <XCircle className="w-3 h-3" />,
  },
};

export function DocumentStatusBadge({ status }: DocumentStatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  return (
    <Badge variant={config.variant}>
      {config.icon}
      {config.label}
    </Badge>
  );
}
